'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ethers } from 'ethers';
import { message } from 'antd';

interface WalletContextType {
  account: string | null;
  chainId: number | null;
  provider: ethers.providers.Web3Provider | null;
  signer: ethers.Signer | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: (targetChainId: number) => Promise<boolean>;
  isConnecting: boolean;
  isConnected: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

interface WalletProviderProps {
  children: ReactNode;
  supportedChainIds?: number[];
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ 
  children,
  supportedChainIds = [1, 5, 137, 80001] // Default supported chains: Mainnet, Goerli, Polygon, Mumbai
}) => {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Check if ethereum is available on window
  const isEthereumAvailable = () => {
    return typeof window !== 'undefined' && window.ethereum;
  };

  // Initialize provider from wallet
  const initializeProvider = async () => {
    if (!isEthereumAvailable()) return;

    const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    setProvider(provider);
    
    try {
      // Get connected accounts
      const accounts = await provider.listAccounts();
      
      if (accounts.length > 0) {
        const signer = provider.getSigner();
        const connectedChainId = (await provider.getNetwork()).chainId;
        
        setAccount(accounts[0]);
        setSigner(signer);
        setChainId(connectedChainId);
        setIsConnected(true);
        
        // Check if connected to supported chain
        if (supportedChainIds.length > 0 && !supportedChainIds.includes(connectedChainId)) {
          message.warning(`Connected to unsupported network. Please switch to a supported network.`);
        }
      }
    } catch (error) {
      console.error('Failed to initialize wallet connection:', error);
    }
  };

  // Connect wallet
  const connectWallet = async () => {
    if (!isEthereumAvailable()) {
      message.error('Please install MetaMask or another compatible wallet');
      return;
    }
    
    setIsConnecting(true);
    
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      
      // Request account access
      await provider.send('eth_requestAccounts', []);
      
      const signer = provider.getSigner();
      const account = await signer.getAddress();
      const chainId = (await provider.getNetwork()).chainId;
      
      setProvider(provider);
      setSigner(signer);
      setAccount(account);
      setChainId(chainId);
      setIsConnected(true);
      
      // Check if connected to supported chain
      if (supportedChainIds.length > 0 && !supportedChainIds.includes(chainId)) {
        message.warning(`Connected to unsupported network. Please switch to a supported network.`);
      }
      
      // Store connection state
      localStorage.setItem('walletConnected', 'true');
      
    } catch (error) {
      console.error('Error connecting wallet:', error);
      if (error instanceof Error) {
        if (error.message.includes('rejected')) {
          message.error('Wallet connection rejected');
        } else {
          message.error(`Failed to connect wallet: ${error.message}`);
        }
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    setAccount(null);
    setSigner(null);
    setIsConnected(false);
    localStorage.removeItem('walletConnected');
    message.success('Wallet disconnected');
  };

  // Switch network
  const switchNetwork = async (targetChainId: number): Promise<boolean> => {
    if (!isEthereumAvailable() || !provider) {
      message.error('Wallet not connected');
      return false;
    }
    
    try {
      // Network configuration
      const networks: { [chainId: number]: any } = {
        1: {
          chainId: '0x1',
          chainName: 'Ethereum Mainnet',
        },
        5: {
          chainId: '0x5',
          chainName: 'Goerli Testnet',
          rpcUrls: ['https://goerli.infura.io/v3/'],
          blockExplorerUrls: ['https://goerli.etherscan.io'],
          nativeCurrency: {
            name: 'Goerli ETH',
            symbol: 'ETH',
            decimals: 18
          }
        },
        137: {
          chainId: '0x89',
          chainName: 'Polygon Mainnet',
          rpcUrls: ['https://polygon-rpc.com/'],
          blockExplorerUrls: ['https://polygonscan.com/'],
          nativeCurrency: {
            name: 'MATIC',
            symbol: 'MATIC',
            decimals: 18
          }
        },
        80001: {
          chainId: '0x13881',
          chainName: 'Mumbai Testnet',
          rpcUrls: ['https://rpc-mumbai.maticvigil.com/'],
          blockExplorerUrls: ['https://mumbai.polygonscan.com/'],
          nativeCurrency: {
            name: 'MATIC',
            symbol: 'MATIC',
            decimals: 18
          }
        }
      };
      
      // Convert chain ID to hex
      const chainIdHex = `0x${targetChainId.toString(16)}`;
      
      try {
        // Try to switch to the network
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }]
        });
        return true;
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902 && networks[targetChainId]) {
          try {
            // Add the network
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [networks[targetChainId]]
            });
            return true;
          } catch (addError) {
            console.error('Error adding network:', addError);
            message.error('Failed to add network to wallet');
            return false;
          }
        } else {
          console.error('Error switching network:', switchError);
          message.error('Failed to switch network');
          return false;
        }
      }
    } catch (error) {
      console.error('Switch network error:', error);
      message.error('Network switch failed');
      return false;
    }
  };

  // Listen for account changes
  useEffect(() => {
    if (!isEthereumAvailable()) return;
    
    const handleAccountsChanged = async (accounts: string[]) => {
      if (accounts.length === 0) {
        // User disconnected their wallet
        setAccount(null);
        setSigner(null);
        setIsConnected(false);
        localStorage.removeItem('walletConnected');
      } else if (accounts[0] !== account) {
        // Account changed
        const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
        const signer = provider.getSigner();
        
        setProvider(provider);
        setSigner(signer);
        setAccount(accounts[0]);
        setIsConnected(true);
      }
    };
    
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    
    return () => {
      if (window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      }
    };
  }, [account]);

  // Listen for chain changes
  useEffect(() => {
    if (!isEthereumAvailable()) return;
    
    const handleChainChanged = (chainIdHex: string) => {
      const chainId = parseInt(chainIdHex, 16);
      setChainId(chainId);
      
      // Check if connected to supported chain
      if (supportedChainIds.length > 0 && !supportedChainIds.includes(chainId)) {
        message.warning(`Connected to unsupported network. Please switch to a supported network.`);
      } else {
        message.success(`Network switched to ${getNetworkName(chainId)}`);
      }
      
      // Need to refresh provider after chain change
      if (window.ethereum) {
        const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
        const signer = provider.getSigner();
        setProvider(provider);
        setSigner(signer);
      }
    };
    
    window.ethereum.on('chainChanged', handleChainChanged);
    
    return () => {
      if (window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [supportedChainIds]);

  // Auto connect if previously connected
  useEffect(() => {
    const autoConnect = async () => {
      const wasConnected = localStorage.getItem('walletConnected') === 'true';
      
      if (wasConnected) {
        await initializeProvider();
      }
    };
    
    if (isEthereumAvailable()) {
      autoConnect();
    }
  }, []);

  // Helper function to get network name
  const getNetworkName = (id: number): string => {
    const networks: { [key: number]: string } = {
      1: 'Ethereum Mainnet',
      3: 'Ropsten Testnet',
      4: 'Rinkeby Testnet',
      5: 'Goerli Testnet',
      42: 'Kovan Testnet',
      56: 'Binance Smart Chain',
      137: 'Polygon Mainnet',
      80001: 'Mumbai Testnet'
    };
    
    return networks[id] || `Chain ID ${id}`;
  };

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        provider,
        signer,
        connectWallet,
        disconnectWallet,
        switchNetwork,
        isConnecting,
        isConnected
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

// Custom hook to use wallet context
export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  
  return context;
};

export default WalletProvider;