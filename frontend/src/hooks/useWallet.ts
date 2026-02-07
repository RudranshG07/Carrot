import { useState, useEffect, useCallback } from 'react';
import freighterApi from '@stellar/freighter-api';

interface WalletState {
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  network: string | null;
}

export const useWallet = () => {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnecting: false,
    error: null,
    network: null,
  });

  const checkConnection = useCallback(async () => {
    try {
      const connected = await freighterApi.isConnected();
      if (!connected) {
        return;
      }

      const allowed = await freighterApi.isAllowed();
      if (allowed) {
        const addrResult = await freighterApi.getAddress();
        const networkDetails = await freighterApi.getNetwork();
        setState(prev => ({
          ...prev,
          address: addrResult.address,
          network: networkDetails.network,
          error: null,
        }));
      }
    } catch (err) {
      console.error('Failed to check wallet connection:', err);
    }
  }, []);

  useEffect(() => {
    checkConnection();

    // Poll for connection changes every 10 seconds
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const connectWallet = async () => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const connected = await freighterApi.isConnected();

      if (!connected) {
        setState(prev => ({
          ...prev,
          isConnecting: false,
          error: 'Freighter wallet not installed. Please install it from freighter.app',
        }));
        window.open('https://freighter.app', '_blank');
        return;
      }

      await freighterApi.setAllowed();
      const addrResult = await freighterApi.getAddress();
      const networkDetails = await freighterApi.getNetwork();

      setState({
        address: addrResult.address,
        isConnecting: false,
        error: null,
        network: networkDetails.network,
      });
    } catch (err: unknown) {
      console.error('Failed to connect wallet:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect wallet';
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
    }
  };

  const disconnectWallet = () => {
    setState({
      address: null,
      isConnecting: false,
      error: null,
      network: null,
    });
  };

  return {
    address: state.address,
    network: state.network,
    isConnecting: state.isConnecting,
    error: state.error,
    connectWallet,
    disconnectWallet,
  };
};
