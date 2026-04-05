/**
 * 启动 App Server
 * npx tsx src/start-server.ts
 */

import 'dotenv/config'
import { createAppServer } from './server/index.js'

const port = parseInt(process.env.PORT || '8080', 10)
createAppServer({ port })
