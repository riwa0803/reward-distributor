import { NextRequest, NextResponse } from 'next/server';
import { RewardService } from '@/services/reward-service';
import { validateRequestBody } from '@/utils/api-validation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/utils/auth';

// Schema for fetch user rewards
const userRewardsSchema = {
  type: 'object',
  required: ['userAddress'],
  properties: {
    userAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
    page: { type: 'number', minimum: 1 },
    limit: { type: 'number', minimum: 1, maximum: 100 }
  }
};

// Schema for batch registration
const batchRegistrationSchema = {
  type: 'object',
  required: ['rewards'],
  properties: {
    rewards: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chainId', 'assetId', 'rewardId', 'airdropId', 'recipient', 'amount'],
        properties: {
          chainId: { type: 'number' },
          assetId: { type: 'number' },
          rewardId: { type: 'number' },
          airdropId: { type: 'number' },
          recipient: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
          amount: { type: 'number', minimum: 0 },
          tokenId: { type: 'number' }
        }
      }
    }
  }
};

// GET handler for user rewards
export async function GET(request: NextRequest) {
  // Get URL parameters
  const searchParams = request.nextUrl.searchParams;
  const userAddress = searchParams.get('userAddress');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  
  if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    return NextResponse.json(
      { error: 'Invalid userAddress' },
      { status: 400 }
    );
  }
  
  try {
    const rewardService = new RewardService();
    const rewardsData = await rewardService.getUserRewards(userAddress, page, limit);
    
    return NextResponse.json(rewardsData);
  } catch (error) {
    console.error('Error fetching user rewards:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rewards' },
      { status: 500 }
    );
  }
}

// POST handler for registering batch rewards
export async function POST(request: NextRequest) {
  try {
    // Verify admin or operator role
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.roles?.includes('admin')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    
    // Validate request
    const validationResult = validateRequestBody(body, batchRegistrationSchema);
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.errors },
        { status: 400 }
      );
    }
    
    const { rewards } = body;
    
    const rewardService = new RewardService();
    const registeredRewards = await rewardService.registerRewardBatch(rewards);
    
    return NextResponse.json({
      success: true,
      registeredCount: registeredRewards.length,
      rewards: registeredRewards
    });
  } catch (error) {
    console.error('Error registering rewards:', error);
    
    return NextResponse.json(
      { error: 'Failed to register rewards', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Configure API route
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb', // Limit for batch operations
    },
  },
};