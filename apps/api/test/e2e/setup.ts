import * as dotenv from 'dotenv';
import * as path from 'path';

// Set test environment
process.env.NODE_ENV = 'test';

// Load .env.local file for E2E tests
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
