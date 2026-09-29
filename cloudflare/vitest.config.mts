import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					JWT_SECRET: 'test-only-secret',
					NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test',
					SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
					NEXT_PUBLIC_POSTHOG_KEY: '',
				},
			},
		}),
	],
	test: { testTimeout: 20_000, include: ['test/**/*.test.ts'] },
});
