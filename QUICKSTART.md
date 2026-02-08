# Quick Start

## Install Dependencies

```bash
npm install
```

## Run in Development Mode

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a player nickname in the search field
2. Click "Load Decks" or press Enter
3. Browse the player's deck list

## Configure the Real API

By default, the app uses mock data for demonstration.

To connect to the real SolForge Fusion API:

1. Create a `.env.local` file:
```bash
cp .env.example .env.local
```

2. Fill in the environment variables in `.env.local`

3. Update `getPlayerDecks` in `lib/api.ts` according to the SolForge Fusion API documentation

## Build for Production

```bash
npm run build
npm start
```
