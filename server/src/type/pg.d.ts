declare module "pg" {
    export type PoolConfig = {
        connectionString?: string;
        max?: number;
        idleTimeoutMillis?: number;
        connectionTimeoutMillis?: number;
    };

    export type QueryResult<Row> = {
        rows: Row[];
        rowCount: number | null;
    };

    export class Pool {
        constructor(config?: PoolConfig);
        query<Row = Record<string, unknown>>(
            text: string,
            values?: readonly unknown[],
        ): Promise<QueryResult<Row>>;
        end(): Promise<void>;
    }
}
