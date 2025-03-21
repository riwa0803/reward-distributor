import { Knex } from 'knex';
import { db } from './database';
import { logger } from './logger';

/**
 * トランザクション安全性を向上させるユーティリティ
 * - 完全なトランザクション分離
 * - エラーハンドリングの統一
 * - 一貫性のあるロールバック処理
 * - 明示的なエラーロギング
 */
export class TransactionManager {
  /**
   * トランザクションで処理を実行
   * @param operation トランザクション内で実行する操作
   * @param isolationLevel トランザクション分離レベル
   * @returns 操作の結果
   */
  static async executeInTransaction<T>(
    operation: (trx: Knex.Transaction) => Promise<T>,
    isolationLevel: Knex.IsolationLevel = 'read committed'
  ): Promise<T> {
    // トランザクション開始
    const trx = await db.transaction({
      isolationLevel
    });

    try {
      // 操作実行
      const result = await operation(trx);
      
      // 成功したらコミット
      await trx.commit();
      return result;
    } catch (error) {
      // エラー発生時はロールバック
      await trx.rollback();
      
      // エラーログ記録
      logger.error('Transaction failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        isolationLevel
      });
      
      // エラーを再スロー
      throw error;
    }
  }

  /**
   * リトライ機能付きトランザクション実行
   * ネットワークエラーなど一時的な問題の場合に再試行
   * @param operation トランザクション内で実行する操作
   * @param options リトライオプション
   * @returns 操作の結果
   */
  static async executeWithRetry<T>(
    operation: (trx: Knex.Transaction) => Promise<T>,
    options: {
      maxRetries?: number;
      initialDelay?: number;
      backoffFactor?: number;
      isolationLevel?: Knex.IsolationLevel;
      retryableErrors?: RegExp[];
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      initialDelay = 100,
      backoffFactor = 2,
      isolationLevel = 'read committed',
      retryableErrors = [
        /deadlock/i,
        /lock timeout/i,
        /connection/i,
        /network/i,
        /timeout/i,
        /busy/i
      ]
    } = options;

    let attempts = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await this.executeInTransaction(operation, isolationLevel);
      } catch (error) {
        attempts++;
        
        // 最大リトライ回数を超えた場合はエラーを再スロー
        if (attempts >= maxRetries) {
          logger.error(`Transaction failed after ${attempts} attempts`, {
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
        
        // リトライ可能なエラーかチェック
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryable = retryableErrors.some(pattern => pattern.test(errorMessage));
        
        if (!isRetryable) {
          logger.error('Non-retryable transaction error', {
            error: errorMessage
          });
          throw error;
        }
        
        // リトライ前に待機
        logger.warn(`Retrying transaction (attempt ${attempts + 1}/${maxRetries})`, {
          delay,
          error: errorMessage
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= backoffFactor; // 指数バックオフ
      }
    }
  }

  /**
   * トランザクションでの複数の操作を順次実行
   * すべての操作が成功するか、全てロールバックします
   * @param operations トランザクション内で実行する操作の配列
   * @param isolationLevel トランザクション分離レベル
   * @returns 各操作の結果の配列
   */
  static async executeSequence<T>(
    operations: ((trx: Knex.Transaction) => Promise<T>)[],
    isolationLevel: Knex.IsolationLevel = 'read committed'
  ): Promise<T[]> {
    return this.executeInTransaction(async (trx) => {
      const results: T[] = [];
      
      for (const operation of operations) {
        const result = await operation(trx);
        results.push(result);
      }
      
      return results;
    }, isolationLevel);
  }

  /**
   * セーブポイント機能付きのトランザクション
   * 部分的なロールバックが必要な場合に使用
   * @param operation トランザクション内で実行する操作
   * @returns 操作の結果
   */
  static async executeWithSavepoints<T>(
    operation: (trx: Knex.Transaction, createSavepoint: (name: string) => Promise<void>, rollbackToSavepoint: (name: string) => Promise<void>) => Promise<T>,
    isolationLevel: Knex.IsolationLevel = 'read committed'
  ): Promise<T> {
    return this.executeInTransaction(async (trx) => {
      // セーブポイント生成関数
      const createSavepoint = async (name: string) => {
        await trx.raw(`SAVEPOINT ${name}`);
      };
      
      // セーブポイントへのロールバック関数
      const rollbackToSavepoint = async (name: string) => {
        await trx.raw(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      
      return operation(trx, createSavepoint, rollbackToSavepoint);
    }, isolationLevel);
  }
}

/**
 * 一貫性チェック用のユーティリティ
 */
export class ConsistencyChecker {
  /**
   * データの整合性チェック
   * @param trx トランザクションオブジェクト
   * @param table テーブル名
   * @param condition 条件
   * @param errorMessage エラーメッセージ
   */
  static async assertExists(
    trx: Knex.Transaction,
    table: string,
    condition: Record<string, any>,
    errorMessage: string
  ): Promise<void> {
    const record = await trx(table).where(condition).first();
    
    if (!record) {
      throw new Error(errorMessage);
    }
  }

  /**
   * 重複チェック
   * @param trx トランザクションオブジェクト
   * @param table テーブル名
   * @param condition 条件
   * @param errorMessage エラーメッセージ
   */
  static async assertNotExists(
    trx: Knex.Transaction,
    table: string,
    condition: Record<string, any>,
    errorMessage: string
  ): Promise<void> {
    const record = await trx(table).where(condition).first();
    
    if (record) {
      throw new Error(errorMessage);
    }
  }
}

/**
 * トランザクション用デコレータ
 * クラスのメソッドをトランザクションで自動的にラップ
 */
export function Transactional(isolationLevel: Knex.IsolationLevel = 'read committed') {
  return function(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      return TransactionManager.executeInTransaction(async (trx) => {
        // トランザクションをメソッドに渡す
        return originalMethod.apply(this, [...args, trx]);
      }, isolationLevel);
    };
    
    return descriptor;
  };
}

/**
 * リトライ機能付きトランザクションデコレータ
 */
export function TransactionalWithRetry(options: {
  maxRetries?: number;
  initialDelay?: number;
  backoffFactor?: number;
  isolationLevel?: Knex.IsolationLevel;
  retryableErrors?: RegExp[];
} = {}) {
  return function(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      return TransactionManager.executeWithRetry(async (trx) => {
        // トランザクションをメソッドに渡す
        return originalMethod.apply(this, [...args, trx]);
      }, options);
    };
    
    return descriptor;
  };
}