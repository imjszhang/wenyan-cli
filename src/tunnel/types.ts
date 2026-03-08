export type TunnelCloudflareConfig = {
    apiToken: string;
    accountId: string;
    zoneId: string;
    hostname: string;
};

export type TunnelConfig = {
    enabled: boolean;
    cloudflare: TunnelCloudflareConfig;
    cloudflaredPath?: string;
};

export type TunnelState = {
    tunnelId: string;
    tunnelToken: string;
    tunnelName: string;
    dnsRecordId: string | null;
    hostname: string;
    createdAt: string;
    lastHealthy: string | null;
};

export type TunnelRuntime = {
    running: boolean;
    hostname: string | null;
    tunnelId: string | null;
    publicUrl: string | null;
    error: string | null;
};
