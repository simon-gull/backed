// Vercel Serverless Function: Update Backed Scores
// Called by Vercel cron (daily 08:00 UTC) or manually via GET /api/update-scores
// Fetches live stock data from Finnhub + news from Google News RSS
// Writes results to Supabase scores_cache table

import { createClient } from '@supabase/supabase-js';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================
// WORLD STATE (must match frontend)
// ============================================================
const WORLD_VIBES = {
  'normal':         { market: 1.0, news: 1.0, community: 1.0 },
  'ai-boom':        { market: 0.9, news: 1.4, community: 1.0 },
  'market-crash':   { market: 1.5, news: 0.8, community: 0.7 },
  'viral-chaos':    { market: 0.7, news: 1.0, community: 1.6 },
  'earnings-week':  { market: 1.3, news: 1.1, community: 0.8 },
};
const CURRENT_VIBE = 'ai-boom';
const WORLD = WORLD_VIBES[CURRENT_VIBE];

// ============================================================
// ROSTER (must match frontend — ID + scoring fields only)
// ============================================================
const ROSTER = [
  // Blue Chips
  { id:"tim-cook",              name:"Tim Cook",              company:"Apple",             ticker:"AAPL",        marketSens:1.3, newsSens:0.6, communitySens:0.4, volatility:0.4, category:"blue-chip" },
  { id:"satya-nadella",         name:"Satya Nadella",         company:"Microsoft",         ticker:"MSFT",        marketSens:1.3, newsSens:0.6, communitySens:0.4, volatility:0.4, category:"blue-chip" },
  { id:"sundar-pichai",         name:"Sundar Pichai",         company:"Alphabet",          ticker:"GOOG",        marketSens:1.2, newsSens:0.7, communitySens:0.4, volatility:0.5, category:"blue-chip" },
  { id:"lisa-su",               name:"Lisa Su",               company:"AMD",               ticker:"AMD",         marketSens:1.2, newsSens:0.8, communitySens:0.5, volatility:0.7, category:"blue-chip" },
  { id:"andy-jassy",            name:"Andy Jassy",            company:"Amazon",            ticker:"AMZN",        marketSens:1.3, newsSens:0.6, communitySens:0.3, volatility:0.4, category:"blue-chip" },
  { id:"larry-ellison",         name:"Larry Ellison",         company:"Oracle",            ticker:"ORCL",        marketSens:1.2, newsSens:0.6, communitySens:0.4, volatility:0.4, category:"blue-chip" },
  { id:"michael-dell",          name:"Michael Dell",          company:"Dell Technologies", ticker:"DELL",        marketSens:1.2, newsSens:0.5, communitySens:0.3, volatility:0.5, category:"blue-chip" },
  { id:"reed-hastings",         name:"Reed Hastings",         company:"Netflix",           ticker:"NFLX",        marketSens:1.2, newsSens:0.7, communitySens:0.6, volatility:0.6, category:"blue-chip" },
  { id:"brian-chesky",          name:"Brian Chesky",          company:"Airbnb",            ticker:"ABNB",        marketSens:1.1, newsSens:0.8, communitySens:0.5, volatility:0.5, category:"blue-chip" },
  { id:"dara-khosrowshahi",     name:"Dara Khosrowshahi",     company:"Uber",              ticker:"UBER",        marketSens:1.2, newsSens:0.8, communitySens:0.4, volatility:0.6, category:"blue-chip" },
  { id:"daniel-ek",             name:"Daniel Ek",             company:"Spotify",           ticker:"SPOT",        marketSens:1.2, newsSens:0.9, communitySens:0.6, volatility:0.6, category:"blue-chip" },
  { id:"tobias-lutke",          name:"Tobias Lütke",          company:"Shopify",           ticker:"SHOP",        marketSens:1.3, newsSens:0.8, communitySens:0.6, volatility:0.7, category:"blue-chip" },
  { id:"warren-buffett",        name:"Warren Buffett",        company:"Berkshire Hathaway", ticker:"BRK.B",      marketSens:1.4, newsSens:0.4, communitySens:0.3, volatility:0.3, category:"blue-chip" },
  { id:"jamie-dimon",           name:"Jamie Dimon",           company:"JPMorgan Chase",    ticker:"JPM",         marketSens:1.3, newsSens:0.7, communitySens:0.4, volatility:0.4, category:"blue-chip" },
  { id:"ken-griffin",           name:"Ken Griffin",           company:"Citadel",           ticker:null,          marketSens:1.2, newsSens:0.5, communitySens:0.3, volatility:0.5, category:"blue-chip" },
  { id:"stephen-schwarzman",    name:"Stephen Schwarzman",    company:"Blackstone",        ticker:"BX",          marketSens:1.3, newsSens:0.5, communitySens:0.3, volatility:0.4, category:"blue-chip" },
  { id:"bill-ackman",           name:"Bill Ackman",           company:"Pershing Square",   ticker:null,          marketSens:1.1, newsSens:1.0, communitySens:0.8, volatility:0.7, category:"blue-chip" },
  { id:"cathie-wood",           name:"Cathie Wood",           company:"ARK Invest",        ticker:"ARKK",        marketSens:1.3, newsSens:1.0, communitySens:0.8, volatility:1.0, category:"blue-chip" },
  { id:"bernard-arnault",       name:"Bernard Arnault",       company:"LVMH",              ticker:null,          marketSens:1.4, newsSens:0.5, communitySens:0.3, volatility:0.5, category:"blue-chip" },
  { id:"phil-knight",           name:"Phil Knight",           company:"Nike",              ticker:"NKE",         marketSens:1.3, newsSens:0.4, communitySens:0.4, volatility:0.4, category:"blue-chip" },
  { id:"bob-iger",              name:"Bob Iger",              company:"Disney",            ticker:"DIS",         marketSens:1.2, newsSens:0.8, communitySens:0.5, volatility:0.6, category:"blue-chip" },
  { id:"mukesh-ambani",         name:"Mukesh Ambani",         company:"Reliance Industries", ticker:null,        marketSens:1.3, newsSens:0.6, communitySens:0.4, volatility:0.5, category:"blue-chip" },
  { id:"wang-chuanfu",          name:"Wang Chuanfu",          company:"BYD",               ticker:null,          marketSens:1.3, newsSens:0.7, communitySens:0.4, volatility:0.6, category:"blue-chip" },
  { id:"michelle-zatlyn",       name:"Michelle Zatlyn",       company:"Cloudflare",        ticker:"NET",         marketSens:1.2, newsSens:0.7, communitySens:0.5, volatility:0.7, category:"blue-chip" },
  { id:"whitney-wolfe-herd",    name:"Whitney Wolfe Herd",    company:"Bumble",            ticker:"BMBL",        marketSens:1.1, newsSens:0.9, communitySens:0.7, volatility:0.8, category:"blue-chip" },
  { id:"mary-barra",            name:"Mary Barra",            company:"General Motors",    ticker:"GM",          marketSens:1.3, newsSens:0.8, communitySens:0.4, volatility:0.6, category:"blue-chip" },
  { id:"jane-fraser",           name:"Jane Fraser",           company:"Citigroup",         ticker:"C",           marketSens:1.3, newsSens:0.7, communitySens:0.4, volatility:0.5, category:"blue-chip" },
  { id:"safra-catz",            name:"Safra Catz",            company:"Oracle",            ticker:"ORCL",        marketSens:1.2, newsSens:0.6, communitySens:0.3, volatility:0.4, category:"blue-chip" },

  // Momentum
  { id:"elon-musk",             name:"Elon Musk",             company:"Tesla / SpaceX / xAI", ticker:"TSLA",     marketSens:1.2, newsSens:1.5, communitySens:1.5, volatility:1.5, category:"momentum" },
  { id:"jensen-huang",          name:"Jensen Huang",          company:"NVIDIA",            ticker:"NVDA",        marketSens:1.3, newsSens:1.3, communitySens:1.0, volatility:1.2, category:"momentum" },
  { id:"mark-zuckerberg",       name:"Mark Zuckerberg",       company:"Meta",              ticker:"META",        marketSens:1.2, newsSens:1.2, communitySens:0.9, volatility:1.0, category:"momentum" },
  { id:"jeff-bezos",            name:"Jeff Bezos",            company:"Blue Origin / Amazon", ticker:null,       marketSens:0.8, newsSens:1.2, communitySens:1.0, volatility:1.1, category:"momentum" },
  { id:"bill-gates",            name:"Bill Gates",            company:"TerraPower / Gates Foundation", ticker:null, marketSens:0.5, newsSens:1.1, communitySens:0.7, volatility:0.8, category:"momentum" },
  { id:"masayoshi-son",         name:"Masayoshi Son",         company:"SoftBank",          ticker:null,          marketSens:1.2, newsSens:1.2, communitySens:0.6, volatility:1.2, category:"momentum" },
  { id:"gautam-adani",          name:"Gautam Adani",          company:"Adani Group",       ticker:null,          marketSens:1.3, newsSens:1.3, communitySens:0.5, volatility:1.3, category:"momentum" },
  { id:"sam-altman",            name:"Sam Altman",            company:"OpenAI",            ticker:null,          marketSens:0.4, newsSens:1.5, communitySens:1.2, volatility:1.3, category:"momentum" },
  { id:"dario-amodei",          name:"Dario Amodei",          company:"Anthropic",         ticker:null,          marketSens:0.4, newsSens:1.3, communitySens:0.9, volatility:1.1, category:"momentum" },
  { id:"daniela-amodei",        name:"Daniela Amodei",        company:"Anthropic",         ticker:null,          marketSens:0.4, newsSens:1.2, communitySens:0.8, volatility:1.0, category:"momentum" },
  { id:"mira-murati",           name:"Mira Murati",           company:"Thinking Machines Lab", ticker:null,      marketSens:0.3, newsSens:1.3, communitySens:1.0, volatility:1.2, category:"momentum" },
  { id:"demis-hassabis",        name:"Demis Hassabis",        company:"Google DeepMind",   ticker:null,          marketSens:0.4, newsSens:1.2, communitySens:0.7, volatility:0.9, category:"momentum" },
  { id:"fei-fei-li",            name:"Fei-Fei Li",            company:"World Labs",        ticker:null,          marketSens:0.3, newsSens:1.2, communitySens:1.0, volatility:1.0, category:"momentum" },
  { id:"alexandr-wang",         name:"Alexandr Wang",         company:"Meta Superintelligence Labs", ticker:null, marketSens:0.5, newsSens:1.3, communitySens:0.9, volatility:1.1, category:"momentum" },
  { id:"aravind-srinivas",      name:"Aravind Srinivas",      company:"Perplexity",        ticker:null,          marketSens:0.3, newsSens:1.3, communitySens:1.1, volatility:1.2, category:"momentum" },
  { id:"arthur-mensch",         name:"Arthur Mensch",         company:"Mistral AI",        ticker:null,          marketSens:0.4, newsSens:1.2, communitySens:0.8, volatility:1.0, category:"momentum" },
  { id:"mustafa-suleyman",      name:"Mustafa Suleyman",      company:"Microsoft AI",      ticker:null,          marketSens:0.6, newsSens:1.2, communitySens:0.7, volatility:0.9, category:"momentum" },
  { id:"lucy-guo",              name:"Lucy Guo",              company:"Passes",            ticker:null,          marketSens:0.3, newsSens:1.3, communitySens:1.4, volatility:1.3, category:"momentum" },
  { id:"peter-thiel",           name:"Peter Thiel",           company:"Palantir / Founders Fund", ticker:"PLTR", marketSens:1.0, newsSens:1.3, communitySens:0.9, volatility:1.1, category:"momentum" },
  { id:"alex-karp",             name:"Alex Karp",             company:"Palantir",          ticker:"PLTR",        marketSens:1.2, newsSens:1.2, communitySens:0.9, volatility:1.2, category:"momentum" },
  { id:"palmer-luckey",         name:"Palmer Luckey",         company:"Anduril",           ticker:null,          marketSens:0.4, newsSens:1.3, communitySens:1.1, volatility:1.1, category:"momentum" },
  { id:"brian-armstrong",       name:"Brian Armstrong",       company:"Coinbase",          ticker:"COIN",        marketSens:1.4, newsSens:1.2, communitySens:0.9, volatility:1.4, category:"momentum" },
  { id:"michael-saylor",        name:"Michael Saylor",        company:"Strategy",          ticker:"MSTR",        marketSens:1.5, newsSens:1.3, communitySens:1.1, volatility:1.5, category:"momentum" },
  { id:"vitalik-buterin",       name:"Vitalik Buterin",       company:"Ethereum",          ticker:null,          marketSens:1.3, newsSens:1.1, communitySens:1.1, volatility:1.3, category:"momentum" },
  { id:"patrick-collison",      name:"Patrick Collison",      company:"Stripe",            ticker:null,          marketSens:0.4, newsSens:1.1, communitySens:0.8, volatility:0.9, category:"momentum" },
  { id:"sebastian-siemiatkowski", name:"Sebastian Siemiatkowski", company:"Klarna",        ticker:null,          marketSens:0.6, newsSens:1.2, communitySens:0.9, volatility:1.1, category:"momentum" },
  { id:"dylan-field",           name:"Dylan Field",           company:"Figma",             ticker:null,          marketSens:0.4, newsSens:1.0, communitySens:0.8, volatility:0.9, category:"momentum" },
  { id:"melanie-perkins",       name:"Melanie Perkins",       company:"Canva",             ticker:null,          marketSens:0.3, newsSens:1.0, communitySens:0.8, volatility:0.8, category:"momentum" },

  // Wildcards
  { id:"kim-kardashian",        name:"Kim Kardashian",        company:"SKIMS",             ticker:null,          marketSens:0.3, newsSens:1.2, communitySens:1.5, volatility:1.2, category:"wildcard" },
  { id:"rihanna",               name:"Rihanna",               company:"Fenty Beauty",      ticker:null,          marketSens:0.3, newsSens:1.2, communitySens:1.4, volatility:1.1, category:"wildcard" },
  { id:"kylie-jenner",          name:"Kylie Jenner",          company:"Kylie Cosmetics",   ticker:null,          marketSens:0.3, newsSens:1.1, communitySens:1.4, volatility:1.0, category:"wildcard" },
  { id:"taylor-swift",          name:"Taylor Swift",          company:"Taylor Swift Productions", ticker:null,   marketSens:0.3, newsSens:1.3, communitySens:1.5, volatility:1.1, category:"wildcard" },
  { id:"emma-grede",            name:"Emma Grede",            company:"Good American / SKIMS", ticker:null,      marketSens:0.3, newsSens:1.1, communitySens:1.3, volatility:1.0, category:"wildcard" },
  { id:"huda-kattan",           name:"Huda Kattan",           company:"Huda Beauty",       ticker:null,          marketSens:0.3, newsSens:1.1, communitySens:1.4, volatility:1.0, category:"wildcard" },
  { id:"jay-z",                 name:"Jay-Z",                 company:"Roc Nation",        ticker:null,          marketSens:0.4, newsSens:1.1, communitySens:1.2, volatility:0.9, category:"wildcard" },
  { id:"ryan-reynolds",         name:"Ryan Reynolds",         company:"Maximum Effort / Wrexham AFC", ticker:null, marketSens:0.4, newsSens:1.2, communitySens:1.3, volatility:1.0, category:"wildcard" },
  { id:"mrbeast",               name:"Jimmy Donaldson",       company:"Beast Industries",  ticker:null,          marketSens:0.3, newsSens:1.3, communitySens:1.6, volatility:1.4, category:"wildcard" },
  { id:"steven-bartlett",       name:"Steven Bartlett",       company:"Flight Story / Diary of a CEO", ticker:null, marketSens:0.3, newsSens:1.2, communitySens:1.3, volatility:1.1, category:"wildcard" },
  { id:"alex-hormozi",          name:"Alex Hormozi",          company:"Acquisition.com",   ticker:null,          marketSens:0.3, newsSens:1.0, communitySens:1.4, volatility:1.0, category:"wildcard" },
  { id:"toto-wolff",            name:"Toto Wolff",            company:"Mercedes F1",       ticker:null,          marketSens:0.4, newsSens:1.3, communitySens:1.0, volatility:1.2, category:"wildcard" },
  { id:"cristiano-ronaldo",     name:"Cristiano Ronaldo",     company:"CR7 Brand",         ticker:null,          marketSens:0.3, newsSens:1.3, communitySens:1.5, volatility:1.1, category:"wildcard" },
  { id:"david-beckham",         name:"David Beckham",         company:"Inter Miami / DB Ventures", ticker:null,   marketSens:0.3, newsSens:1.2, communitySens:1.3, volatility:1.0, category:"wildcard" },
];

// ============================================================
// MEDIA / SENTIMENT CONSTANTS
// ============================================================
const TIER1_SOURCES = ['bloomberg', 'wsj', 'wall street journal', 'financial times', 'ft.com', 'reuters', 'nytimes', 'new york times', 'bbc'];
const TIER2_SOURCES = ['techcrunch', 'the verge', 'cnbc', 'forbes', 'wired', 'guardian', 'economist'];
const POSITIVE_WORDS = ['surge', 'growth', 'profit', 'record', 'innovation', 'launch', 'success', 'milestone', 'breakthrough', 'soar', 'beat', 'exceed', 'expand', 'partnership', 'award', 'deal', 'bullish', 'rally', 'upgrade', 'hire', 'raise', 'ipo'];
const NEGATIVE_WORDS = ['crash', 'loss', 'scandal', 'lawsuit', 'fraud', 'layoff', 'decline', 'slump', 'investigation', 'controversy', 'fine', 'penalty', 'sued', 'fired', 'resign', 'downturn', 'bearish', 'selloff', 'downgrade', 'cut'];

// ============================================================
// STOCK DATA (Finnhub)
// ============================================================
async function fetchStockQuote(ticker) {
  if (!ticker || !FINNHUB_KEY) return null;
  // Finnhub free tier only supports US tickers
  if (ticker.includes('.')) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      price: data.c || 0,
      change: data.dp || 0,
      prevClose: data.pc || 0,
    };
  } catch (e) {
    console.error(`Stock fetch failed for ${ticker}:`, e.message);
    return null;
  }
}

// ============================================================
// NEWS DATA (Google News RSS)
// ============================================================
async function fetchNewsForPerson(name, company) {
  try {
    const query = encodeURIComponent(`"${name}" OR "${company}"`);
    const res = await fetch(`https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`);
    if (!res.ok) return { count: 0, sentiment: 0, headlines: [] };
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const titleMatch = match[1].match(/<title>([\s\S]*?)<\/title>/);
      const sourceMatch = match[1].match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          source: sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim().toLowerCase() : '',
        });
      }
    }

    const recent = items.slice(0, 20);
    let sentimentSum = 0;
    let weightSum = 0;
    for (const item of recent) {
      const text = item.title.toLowerCase();
      let weight = 1;
      if (TIER1_SOURCES.some(s => item.source.includes(s))) weight = 3;
      else if (TIER2_SOURCES.some(s => item.source.includes(s))) weight = 2;
      let itemSentiment = 0;
      POSITIVE_WORDS.forEach(w => { if (text.includes(w)) itemSentiment += 0.3; });
      NEGATIVE_WORDS.forEach(w => { if (text.includes(w)) itemSentiment -= 0.3; });
      itemSentiment = Math.max(-1, Math.min(1, itemSentiment));
      sentimentSum += itemSentiment * weight;
      weightSum += weight;
    }
    const avgSentiment = weightSum > 0 ? sentimentSum / weightSum : 0;
    return {
      count: recent.length,
      sentiment: Math.round(avgSentiment * 100) / 100,
      headlines: recent.slice(0, 5).map(i => i.title),
    };
  } catch (e) {
    console.error(`News fetch failed for ${name}:`, e.message);
    return { count: 0, sentiment: 0, headlines: [] };
  }
}

// ============================================================
// SIGNAL EXTRACTION — raw 0-30 scale per signal
// ============================================================
function marketSignal(stockData) {
  // Stock change % -> 0-30 (0% = 15, +10% = 30, -10% = 0)
  if (!stockData) return 0; // private/foreign — no market signal available
  return Math.max(0, Math.min(30, 15 + (stockData.change * 1.5)));
}

function newsSignal(newsData) {
  // Combine sentiment and volume -> 0-30
  const sentimentBase = ((newsData.sentiment + 1) / 2) * 20; // 0-20 baseline
  const volumeBoost   = Math.min(newsData.count / 20, 1) * 10; // up to +10 for high volume
  const direction     = newsData.sentiment >= 0 ? 1 : -1;
  return Math.max(0, Math.min(30, sentimentBase + (volumeBoost * direction)));
}

function communitySignal(drafters) {
  // Drafters -> 0-30 (0 = 10 baseline, 50+ = 30)
  return Math.max(0, Math.min(30, 10 + Math.min(drafters / 50, 1) * 20));
}

// ============================================================
// BACKED SCORE — v2 engine with sensitivities + world state
// ============================================================
function computeBackedScore(person, signals) {
  const raw =
    (signals.market    * (person.marketSens    || 1) * WORLD.market) +
    (signals.news      * (person.newsSens      || 1) * WORLD.news) +
    (signals.community * (person.communitySens || 1) * WORLD.community);
  return raw * (person.volatility || 1);
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch community stats (drafters per person) up front
  let draftersByPerson = {};
  try {
    const { data: teamMembers } = await sb.from('team_members').select('person_id');
    if (teamMembers) {
      teamMembers.forEach(tm => {
        draftersByPerson[tm.person_id] = (draftersByPerson[tm.person_id] || 0) + 1;
      });
    }
  } catch (e) {
    console.error('Community stats fetch failed:', e.message);
  }

  const results = [];
  const errors = [];

  console.log(`Starting score update for ${ROSTER.length} people. World vibe: ${CURRENT_VIBE}`);

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < ROSTER.length; i += 5) {
    const batch = ROSTER.slice(i, i + 5);

    const batchResults = await Promise.all(batch.map(async (person) => {
      try {
        const stockData = await fetchStockQuote(person.ticker);
        const newsData  = await fetchNewsForPerson(person.name, person.company);
        const drafters  = draftersByPerson[person.id] || 0;

        const signals = {
          market:    marketSignal(stockData),
          news:      newsSignal(newsData),
          community: communitySignal(drafters),
        };

        const score = computeBackedScore(person, signals);

        return {
          person_id: person.id,
          stock_price: stockData?.price || null,
          stock_change_pct: stockData?.change || 0,
          sentiment_score: newsData.sentiment,
          backed_score: Math.round(score * 10) / 10,
          total_drafters: drafters,
          updated_at: new Date().toISOString(),
        };
      } catch (e) {
        errors.push({ person: person.id, error: e.message });
        return null;
      }
    }));

    results.push(...batchResults.filter(Boolean));

    // Rate-limit breather
    if (i + 5 < ROSTER.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Upsert to Supabase
  if (results.length > 0) {
    const { error } = await sb
      .from('scores_cache')
      .upsert(results, { onConflict: 'person_id' });
    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  console.log(`Score update complete. ${results.length} updated, ${errors.length} errors.`);

  return res.status(200).json({
    vibe: CURRENT_VIBE,
    world: WORLD,
    updated: results.length,
    errors: errors.length,
    topScorers: results
      .sort((a, b) => b.backed_score - a.backed_score)
      .slice(0, 10)
      .map(r => ({ id: r.person_id, score: r.backed_score, stockChange: r.stock_change_pct, sentiment: r.sentiment_score })),
    ...(errors.length > 0 ? { errorDetails: errors } : {}),
  });
}
