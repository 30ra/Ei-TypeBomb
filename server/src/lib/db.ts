import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";

const connectionString = process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
    throw new Error(
        "SUPABASE_DATABASE_URL is required for the read-only room database connection.",
    );
}

export const roomDatabase = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});
