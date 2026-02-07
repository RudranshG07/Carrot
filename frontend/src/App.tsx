import { useState, useEffect } from "react";
import { useWallet } from "./hooks/useWallet";
import ProviderDashboard from "./pages/ProviderDashboard";
import ConsumerDashboard from "./pages/ConsumerDashboard";
import { areContractsDeployed } from "./config/contracts";
import { getBalance } from "./utils/stellar";

function App() {
  const { address, network, connectWallet, disconnectWallet, isConnecting, error } = useWallet();
  const [view, setView] = useState<"provider" | "consumer">("provider");
  const [balance, setBalance] = useState<string>("0");

  useEffect(() => {
    const loadBalance = async () => {
      if (address) {
        try {
          const bal = await getBalance(address);
          setBalance(bal);
        } catch (err) {
          console.error("Failed to load balance:", err);
        }
      }
    };

    loadBalance();
    // Refresh balance every 30 seconds to reduce network calls
    const interval = setInterval(loadBalance, 30000);
    return () => clearInterval(interval);
  }, [address]);

  const isTestnet = network === 'TESTNET' || network === 'Test SDF Network ; September 2015';

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-orange-500">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <img src="/logo.png" alt="Carrot Logo" className="h-12 w-12 object-contain" />
                <h1 className="text-4xl font-carrot font-bold text-orange-500 tracking-wide">Carrot</h1>
              </div>
              {address && (
                <div className="flex space-x-2">
                  <button
                    onClick={() => setView("provider")}
                    className={`px-4 py-2 rounded-none ${
                      view === "provider"
                        ? "bg-orange-500 text-white font-semibold"
                        : "bg-gray-100 text-orange-500 hover:bg-gray-200 border border-orange-500"
                    }`}
                  >
                    Provider
                  </button>
                  <button
                    onClick={() => setView("consumer")}
                    className={`px-4 py-2 rounded-none ${
                      view === "consumer"
                        ? "bg-orange-500 text-white font-semibold"
                        : "bg-gray-100 text-orange-500 hover:bg-gray-200 border border-orange-500"
                    }`}
                  >
                    Consumer
                  </button>
                </div>
              )}
            </div>
            <div>
              {!address ? (
                <button
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-none font-bold disabled:opacity-50"
                >
                  {isConnecting ? "Connecting..." : "Connect Freighter"}
                </button>
              ) : (
                <div className="flex items-center space-x-4">
                  {/* Network Badge */}
                  <div className="relative">
                    <span
                      className={`px-4 py-2 rounded-none text-sm font-semibold border-2 ${
                        isTestnet
                          ? "border-orange-500 bg-orange-100 text-orange-600"
                          : "border-red-500 bg-red-100 text-red-600"
                      }`}
                    >
                      {isTestnet ? "Stellar Testnet" : network || "Unknown Network"}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-orange-500">
                      {parseFloat(balance).toFixed(4)} XLM
                    </div>
                    <div className="text-xs text-gray-500">
                      {address.slice(0, 8)}...{address.slice(-6)}
                    </div>
                  </div>
                  <button
                    onClick={disconnectWallet}
                    className="bg-gray-100 hover:bg-gray-200 text-orange-500 px-4 py-2 rounded-none text-sm border border-orange-500"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
          {error && (
            <div className="mt-4 bg-orange-100 border border-orange-400 text-orange-700 px-4 py-2 rounded-none">
              {error}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {!address ? (
          <div className="text-center py-20">
            <div className="flex justify-center mb-8">
              <img src="/logo.png" alt="Carrot Logo" className="h-32 w-32 object-contain" />
            </div>
            <h2 className="text-5xl font-carrot font-bold mb-4 text-orange-500 tracking-wide">Welcome to Carrot</h2>
            <p className="text-gray-600 mb-8">
              Connect your Freighter wallet to get started
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Powered by Stellar Soroban
            </p>
            <a
              href="https://freighter.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:text-orange-600 underline"
            >
              Get Freighter Wallet
            </a>
          </div>
        ) : !areContractsDeployed() ? (
          <div className="text-center py-20">
            <div className="bg-orange-100 border-2 border-orange-400 text-orange-700 p-8 rounded-none max-w-2xl mx-auto">
              <h3 className="text-2xl font-bold mb-4">Contracts Not Deployed</h3>
              <p className="mb-4">
                The Soroban smart contracts need to be deployed to Stellar Testnet.
              </p>
              <div className="text-left bg-white p-4 rounded-none border border-orange-300 font-mono text-sm">
                <p className="mb-2">1. Build the contracts:</p>
                <code className="text-orange-600">cd contracts && cargo build --release</code>
                <p className="mt-4 mb-2">2. Deploy to Stellar Testnet</p>
                <p className="mt-4 mb-2">3. Update contract IDs in:</p>
                <code className="text-orange-600">frontend/src/config/contracts.ts</code>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {view === "provider" ? (
              <ProviderDashboard address={address} />
            ) : (
              <ConsumerDashboard address={address} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
