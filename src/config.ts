import Conf from "conf";

export interface AlgopayConfig {
    defaultNetwork: "testnet" | "mainnet";
    sessionToken: string | null;
    walletAddress: string | null;
    slippageTolerance: number;
    autoConfirm: boolean;
    spendingLimits: {
        amount: number;
        period: "hourly" | "daily" | "weekly" | "monthly";
    } | null;
}

const defaults: AlgopayConfig = {
    defaultNetwork: "testnet",
    sessionToken: null,
    walletAddress: null,
    slippageTolerance: 2,
    autoConfirm: false,
    spendingLimits: null,
};

let configInstance: Conf<AlgopayConfig> | null = null;

export function getConfig(): Conf<AlgopayConfig> {
    if (!configInstance) {
        configInstance = new Conf<AlgopayConfig>({
            projectName: "algopay",
            defaults,
        });
    }
    return configInstance;
}

/**
 * Returns the current network endpoints for algod and indexer.
 */
export function getNetworkEndpoints(network: "testnet" | "mainnet") {
    if (network === "mainnet") {
        return {
            algodUrl: "https://mainnet-api.algonode.cloud",
            algodToken: "",
            indexerUrl: "https://mainnet-idx.algonode.cloud",
            indexerToken: "",
            usdcAssetId: 31566704,
            networkName: "mainnet" as const,
        };
    }

    return {
        algodUrl: "https://testnet-api.algonode.cloud",
        algodToken: "",
        indexerUrl: "https://testnet-idx.algonode.cloud",
        indexerToken: "",
        usdcAssetId: 10458941,
        networkName: "testnet" as const,
    };
}
