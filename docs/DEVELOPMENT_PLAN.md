# Crypto Trading AI Assistant - Development Plan

**Project:** Personal AI-powered crypto trading analysis assistant  
**Architecture:** Monorepo (pnpm workspaces) with NestJS backend + Next.js frontend  
**Strategy:** Miraj's crypto trading strategy (RSI, Bollinger Bands, ATR, support/resistance)  
**Goal:** Input coin name → Get entry/exit/stop loss suggestions based on live chart data

---

## Phase 0: Project Setup (30 minutes)

### Deliverables:
- Monorepo folder structure created (apps/api, apps/web, packages/shared)
- pnpm workspaces configured with pnpm-workspace.yaml
- NestJS backend initialized in apps/api
- Next.js frontend initialized in apps/web
- Both apps running locally without errors
- Root package.json has scripts to run both apps together (pnpm dev)

### Tasks:
1. Create root folder and initialize git
2. Create pnpm-workspace.yaml file that includes apps/* and packages/*
3. Initialize NestJS app in apps/api using nest CLI
4. Initialize Next.js app in apps/web using create-next-app with TypeScript and Tailwind
5. Add dev/build/start scripts to root package.json that run all workspace apps
6. Test that both apps start with pnpm dev (backend on 3001, frontend on 3000)

---

## Phase 1.1: Database Setup (20 minutes)

### Deliverables:
- PostgreSQL database connected to NestJS
- Prisma ORM configured
- Database schema created with TradeAnalysis table
- Initial migration run successfully

### Tasks:
1. Install Prisma and PostgreSQL driver in apps/api
2. Initialize Prisma with prisma init command
3. Configure DATABASE_URL in .env file
4. Create Prisma schema with TradeAnalysis model containing fields: id, coin, timeframe, entryPrice, exitPrice, stopLoss, leverage, suggestion (LONG/SHORT/WAIT), reasoning, rsiValue, bbTop, bbBottom, createdAt
5. Run prisma migrate dev to create tables
6. Generate Prisma client

---

## Phase 1.2: Binance API Service (20 minutes)

### Deliverables:
- Service that fetches live candle data from Binance
- Method to get OHLCV data for any coin and any timeframe
- Method to get current price for a coin
- Proper error handling for API failures

### Tasks:
1. Install axios in apps/api
2. Create BinanceService in src/services/
3. Implement getCandles method that accepts symbol, interval, and limit parameters
4. Implement getCurrentPrice method that fetches latest ticker price
5. Format raw Binance API response into clean OHLCV objects
6. Register BinanceService in AppModule
7. Test with a simple API call to verify it works

---

## Phase 1.3: Technical Indicators Service (25 minutes)

### Deliverables:
- Service that calculates technical indicators from candle data
- RSI(14) calculation implemented
- Bollinger Bands(20,2) calculation implemented
- ATR(14) calculation implemented
- Support/resistance level detection logic

### Tasks:
1. Install technicalindicators library in apps/api
2. Create IndicatorsService in src/services/
3. Implement calculateRSI method that takes closing prices array and returns RSI value
4. Implement calculateBollingerBands method that returns upper, middle, lower bands
5. Implement calculateATR method for stop loss calculation
6. Implement identifySupportResistance method that finds recent swing highs and lows
7. Register IndicatorsService in AppModule
8. Test calculations with sample candle data

---

## Phase 1.4: Claude API Service (20 minutes)

### Deliverables:
- Service that calls Claude API with market data and strategy rules
- Prompt template that includes Miraj's strategy checklist
- Parsing logic to extract trade suggestion from Claude's response
- Proper error handling and retry logic

### Tasks:
1. Install @anthropic-ai/sdk in apps/api
2. Create ClaudeService in src/services/
3. Add ANTHROPIC_API_KEY to .env file
4. Create analyzeMarket method that accepts coin data, indicators, and strategy rules
5. Build prompt template that includes: current price, RSI value, Bollinger Band positions, ATR value, support/resistance levels, and Miraj's entry checklist
6. Parse Claude's response to extract: action (LONG/SHORT/WAIT), entry price, TP1/TP2/TP3, stop loss, leverage, reasoning
7. Add error handling for API failures
8. Register ClaudeService in AppModule

---

## Phase 1.5: Analysis Controller & Endpoint (15 minutes)

### Deliverables:
- REST API endpoint POST /analysis/analyze
- Orchestration logic that combines all services
- Response format with complete trade suggestion
- Endpoint saves analysis to database

### Tasks:
1. Create AnalysisController in src/controllers/
2. Create POST /analysis/analyze endpoint that accepts coin name in request body
3. Orchestrate workflow: fetch candles from Binance → calculate indicators → call Claude API → save to database → return result
4. Implement multi-timeframe logic: fetch 1h, 4h, 12h, daily candles
5. Calculate indicators for all timeframes
6. Send comprehensive data to Claude
7. Save Claude's response to database via Prisma
8. Return formatted JSON response to frontend
9. Add validation for coin name input
10. Add error responses for invalid coins or API failures

---

## Phase 2: Frontend - Basic Analysis Page (1 hour)

### Deliverables:
- Next.js page with coin input form
- Button to trigger analysis
- Loading state while API processes request
- Display formatted trade suggestion
- Error handling for failed requests
- Basic styling with Tailwind CSS

### Tasks:
1. Create /analysis page in apps/web
2. Add form with text input for coin name (e.g., "BTC", "ETH")
3. Add analyze button that calls backend POST endpoint
4. Implement loading spinner while waiting for response
5. Display results in clean cards showing: suggested action (LONG/SHORT/WAIT), entry price, TP1/TP2/TP3, stop loss, leverage, reasoning from Claude
6. Add error message display if API call fails
7. Style with Tailwind CSS (clean, professional look)
8. Add validation: coin name required, uppercase conversion
9. Configure Next.js to proxy API calls to backend (localhost:3001)
10. Test full flow: enter BTC → click analyze → see results

---

## Phase 3.1: Analysis History Storage (20 minutes)

### Deliverables:
- Every analysis automatically saved to database
- Database stores: coin, timestamp, suggestion, entry/exit/stop, actual price at time of analysis
- Logic to compare suggested action vs actual price movement after 24h/7d

### Tasks:
1. Extend Prisma schema to include analysisTimestamp field
2. Modify AnalysisController to always save analysis before returning
3. Add priceAtAnalysis field to store current price when analysis was made
4. Create service method to fetch historical analyses for a specific coin
5. Implement logic to calculate if suggestion was correct (did price go up if LONG was suggested?)

---

## Phase 3.2: Backtesting UI (30 minutes)

### Deliverables:
- New frontend page showing analysis history
- Table displaying past analyses with results
- Stats showing win rate percentage
- Filter by coin or date range

### Tasks:
1. Create GET /analysis/history endpoint in backend
2. Add optional query parameters: coin, startDate, endDate
3. Return array of past analyses with calculated results
4. Create /backtesting page in frontend
5. Display table with columns: Date, Coin, Suggested Action, Entry Price, Actual Movement, Result (Win/Loss)
6. Calculate and display win rate: "14 out of 20 suggestions were profitable (70%)"
7. Add filters for coin selection and date range
8. Style with Tailwind to make data easy to read

---

## Phase 4: Multi-Coin Dashboard (1 hour)

### Deliverables:
- Predefined list of 8-12 coins (BTC, ETH, SOL, FET, TRON, RENDER, Zcash, etc.)
- Dashboard showing quick analysis for all coins
- Grid layout with coin cards
- Each card shows: coin name, current price, suggested action, entry/exit

### Tasks:
1. Create coins configuration file in backend with list of supported coins
2. Modify analysis endpoint to accept array of coin names
3. Implement parallel processing so all coins are analyzed simultaneously
4. Create /dashboard page in frontend
5. Display grid of coin cards (responsive: 2 cols mobile, 3-4 cols desktop)
6. Each card shows: coin ticker, current price, suggested action badge (green=LONG, red=SHORT, yellow=WAIT), entry price, TP1, stop loss
7. Add refresh button to re-analyze all coins
8. Add loading skeleton while analyses run
9. Make cards clickable to see full analysis details

---

## Phase 5: Miraj Strategy Integration (2 hours)

### Deliverables:
- Complete Miraj strategy documented in a text file
- Claude prompt embeds full strategy rules
- Multi-timeframe analysis automatically implemented
- Entry checklist displayed showing which conditions are met
- Decision logic follows Miraj's timeframe hierarchy (HTF trend, LTF entry)

### Tasks:
1. Extract key rules from 116-page Miraj strategy PDF
2. Create strategy.txt file documenting: entry conditions (5 checkpoints), exit rules (TP levels), stop loss formula, leverage guidelines, position sizing rules
3. Update ClaudeService prompt to include complete strategy context
4. Modify IndicatorsService to analyze multiple timeframes (1h, 4h, 12h, daily)
5. Implement timeframe hierarchy logic: identify HTF trend first, then find LTF entry
6. Update analysis response to include: which timeframe shows the trend, which conditions are met (e.g., "3 out of 5: RSI oversold ✓, Price at support ✓, Bullish structure ✓, QQE green ✗, Bollinger bottom ✗")
7. Display entry checklist in frontend with visual indicators (checkmarks for met conditions)
8. Show reasoning that explains why action was suggested based on timeframe confluence

---

## Phase 6.1: Position Sizing Calculator (20 minutes)

### Deliverables:
- Calculator that determines position size based on account balance and risk percentage
- Suggests how much capital to allocate per trade
- Displays liquidation price for leveraged trades

### Tasks:
1. Create PositionSizingService in backend
2. Implement calculatePositionSize method: takes account balance, risk % (1-2%), and stop loss distance
3. Calculate appropriate position size so risk equals 1% of account
4. Calculate liquidation price based on leverage
5. Add position size recommendation to analysis response
6. Display in frontend: "With $10,000 account and 1% risk, position size: $500, liquidation at $X"

---

## Phase 6.2: Leverage Recommendations (15 minutes)

### Deliverables:
- Logic to suggest appropriate leverage based on trade type
- Displays leverage with risk warnings

### Tasks:
1. Add getLeverageRecommendation method to strategy service
2. Rules: 2-3x for swing trades (daily/12h timeframe), 5-10x for day trades (4h/1h), 10-20x for scalps (15m/1m)
3. Include leverage in analysis response
4. Display leverage recommendation with warning: "10x leverage = 10% move liquidates position"

---

## Phase 6.3: Export Functionality (15 minutes)

### Deliverables:
- Button to export analysis history as CSV
- Formatted CSV with all relevant fields

### Tasks:
1. Create export endpoint in backend: GET /analysis/export?format=csv
2. Format data as CSV with columns: Date, Coin, Action, Entry, Exit, StopLoss, Leverage, Result
3. Add download button to backtesting page
4. Trigger browser download when clicked
5. Test with sample data

---

## Phase 7: Second Trader Integration (1 hour)

### Deliverables:
- Second trader's strategy documented
- Ability to toggle between Trader 1 and Trader 2
- Comparative view showing both suggestions side-by-side

### Tasks:
1. Watch second trader's videos and extract strategy rules (same process as Miraj)
2. Create second strategy document
3. Modify ClaudeService to support multiple strategies (pass strategy parameter)
4. Add strategy selection to frontend (dropdown or toggle)
5. Create comparison view that shows both traders' suggestions for same coin
6. Highlight differences between approaches

---

## Phase 8: Polish & Optimization (1 hour)

### Deliverables:
- Caching implemented for repeated analyses
- Better error messages throughout
- Mobile-responsive design verified
- Loading states improved
- Project README with setup instructions

### Tasks:
1. Implement caching: if same coin analyzed within 5 minutes, return cached result
2. Add Redis or in-memory cache
3. Improve error messages to be user-friendly
4. Test all pages on mobile devices
5. Add skeleton loaders for better perceived performance
6. Write comprehensive README with: project overview, setup instructions, environment variables needed, how to run locally
7. Add comments to complex logic in code

---

## Phase 9: Deployment (30 minutes)

### Deliverables:
- Backend deployed to Railway or Render
- Frontend deployed to Vercel
- Environment variables configured
- Live application accessible

### Tasks:
1. Push code to GitHub repository
2. Connect Railway/Render to GitHub repo for backend
3. Configure environment variables in Railway/Render dashboard
4. Deploy backend and verify it starts successfully
5. Connect Vercel to GitHub repo for frontend
6. Configure environment variables in Vercel
7. Deploy frontend
8. Update frontend API calls to point to production backend URL
9. Test live version with real API calls
10. Monitor logs for errors

---

## Total Estimate: 10-12 hours

Each phase is self-contained and produces working functionality. You can take breaks between phases and come back without losing context.

---

## Notes:
- Test after each phase before moving to the next
- Use .env files for all secrets (never commit API keys)
- Keep commits small and descriptive
- Ask for best practices review in separate Claude chat if unsure
- Focus on functionality first, polish later
