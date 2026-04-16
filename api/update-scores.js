// Vercel Serverless Function: Update Backed Scores
// Called by Vercel cron (hourly) or manually via GET /api/update-scores
// Fetches live stock data from Finnhub + news from Google News RSS
// Writes results to Supabase scores_cache table

import { createClient } from '@supabase/supabase-js';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Full roster with tickers
const ROSTER = [
  { id:"elon-musk", name:"Elon Musk", company:"Tesla", ticker:"TSLA" },
  { id:"jensen-huang", name:"Jensen Huang", company:"NVIDIA", ticker:"NVDA" },
  { id:"mark-zuckerberg", name:"Mark Zuckerberg", company:"Meta", ticker:"META" },
  { id:"sam-altman", name:"Sam Altman", company:"OpenAI", ticker:null },
  { id:"tim-cook", name:"Tim Cook", company:"Apple", ticker:"AAPL" },
  { id:"satya-nadella", name:"Satya Nadella", company:"Microsoft", ticker:"MSFT" },
  { id:"sundar-pichai", name:"Sundar Pichai", company:"Alphabet", ticker:"GOOG" },
  { id:"lisa-su", name:"Lisa Su", company:"AMD", ticker:"AMD" },
  { id:"bernard-arnault", name:"Bernard Arnault", company:"LVMH", ticker:null },
  { id:"jamie-dimon", name:"Jamie Dimon", company:"JPMorgan", ticker:"JPM" },
  { id:"reed-hastings", name:"Reed Hastings", company:"Netflix", ticker:"NFLX" },
  { id:"brian-chesky", name:"Brian Chesky", company:"Airbnb", ticker:"ABNB" },
  { id:"brian-armstrong", name:"Brian Armstrong", company:"Coinbase", ticker:"COIN" },
  { id:"dara-khosrowshahi", name:"Dara Khosrowshahi", company:"Uber", ticker:"UBER" },
  { id:"andy-jassy", name:"Andy Jassy", company:"Amazon", ticker:"AMZN" },
  { id:"patrick-collison", name:"Patrick Collison", company:"Stripe", ticker:null },
  { id:"masayoshi-son", name:"Masayoshi Son", company:"SoftBank", ticker:null },
  { id:"changpeng-zhao", name:"Changpeng Zhao", company:"Binance", ticker:null },
  { id:"whitney-wolfe-herd", name:"Whitney Wolfe Herd", company:"Bumble", ticker:"BMBL" },
  { id:"daniel-ek", name:"Daniel Ek", company:"Spotify", ticker:"SPOT" },
  { id:"sebastian-siemiatkowski", name:"Sebastian Siemiatkowski", company:"Klarna", ticker:null },
  { id:"pieter-van-der-does", name:"Pieter van der Does", company:"Adyen", ticker:null },
  { id:"jitse-groen", name:"Jitse Groen", company:"Just Eat Takeaway", ticker:null },
  { id:"taavet-hinrikus", name:"Taavet Hinrikus", company:"Wise", ticker:null },
  { id:"nikolay-storonsky", name:"Nikolay Storonsky", company:"Revolut", ticker:null },
  { id:"anne-boden", name:"Anne Boden", company:"Starling Bank", ticker:null },
  { id:"steven-bartlett", name:"Steven Bartlett", company:"Diary of a CEO", ticker:null },
  { id:"alex-chesterman", name:"Alex Chesterman", company:"Zoopla/Cazoo", ticker:null },
  { id:"ida-tin", name:"Ida Tin", company:"Clue", ticker:null },
  { id:"henrik-henriksson", name:"Henrik Henriksson", company:"H2 Green Steel", ticker:null },
  { id:"bas-lansdorp", name:"Bas Lansdorp", company:"Mars One", ticker:null },
  { id:"mathias-dopfner", name:"Mathias Döpfner", company:"Axel Springer", ticker:null },
  { id:"mikael-hed", name:"Mikael Hed", company:"Rovio", ticker:null },
  { id:"nikolaj-nyholm", name:"Nikolaj Nyholm", company:"CEGO", ticker:null },
  { id:"will-shu", name:"Will Shu", company:"Deliveroo", ticker:null },
  { id:"pernille-blume", name:"Pernille Blume", company:"Independent Athlete", ticker:null },
];

// Tier 1 media sources for weighting
const TIER1_SOURCES = ['bloomberg', 'wsj', 'wall street journal', 'financial times', 'ft.com', 'reuters', 'nytimes', 'new york times', 'bbc'];
const TIER2_SOURCES = ['techcrunch', 'the verge', 'cnbc', 'forbes', 'wired', 'guardian', 'economist'];

const POSITIVE_WORDS = ['surge', 'growth', 'profit', 'record', 'innovation', 'launch', 'success', 'milestone', 'breakthrough', 'soar', 'beat', 'exceed', 'expand', 'partnership', 'award', 'deal', 'bullish', 'rally', 'upgrade', 'hire'];
const NEGATIVE_WORDS = ['crash', 'loss', 'scandal', 'lawsuit', 'fraud', 'layoff', 'decline', 'slump', 'investigation', 'controversy', 'fine', 'penalty', 'sued', 'fired', 'resign', 'downturn', 'bearish', 'selloff', 'downgrade', 'cut'];

// ============================================================
// STOCK DATA (Finnhub)
// ============================================================
async function fetchStockQuote(ticker) {
  if (!ticker || !FINNHUB_KEY) return null;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      price: data.c || 0,        // current price
      change: data.dp || 0,       // percent change today
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
    const res = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`
    );
    if (!res.ok) return { count: 0, sentiment: 0, headlines: [] };

    const xml = await res.text();

    // Parse items from RSS
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const titleMatch = match[1].match(/<title>([\s\S]*?)<\/title>/);
      const sourceMatch = match[1].match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          source: sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim().toLowerCase() : ''
        });
      }
    }

    // Limit to last 20 articles
    const recent = items.slice(0, 20);

    // Calculate weighted sentiment
    let sentimentSum = 0;
    let weightSum = 0;

    for (const item of recent) {
      const text = item.title.toLowerCase();
      let weight = 1;

      // Tier weighting
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
      sentiment: Math.round(avgSentiment * 100) / 100, // -1.0 to 1.0
      headlines: recent.slice(0, 5).map(i => i.title),
    };
  } catch (e) {
    console.error(`News fetch failed for ${name}:`, e.message);
    return { count: 0, sentiment: 0, headlines: [] };
  }
}

// ============================================================
// SCORE CALCULATION
// ============================================================
function calculateBackedScore(stockData, newsData, hasPublicTicker) {
  // Stock score: normalize percent change to 0-100
  // -10% or worse = 0, +10% or better = 100
  let stockScore = 50; // default for private companies
  if (stockData && hasPublicTicker) {
    stockScore = Math.max(0, Math.min(100, (stockData.change + 10) * 5));
  }

  // News score: sentiment (-1 to 1) → 0-100
  // Plus volume bonus: more articles = more impact (capped)
  let newsScore = 50;
  if (newsData.count > 0) {
    const sentimentBase = ((newsData.sentiment + 1) / 2) * 100;
    const volumeBonus = Math.min(newsData.count / 20, 1) * 10; // up to +10 for high volume
    const direction = newsData.sentiment >= 0 ? 1 : -1;
    newsScore = Math.max(0, Math.min(100, sentimentBase + (volumeBonus * direction)));
  }

  // Community score: placeholder 50 until we have real data
  const communityScore = 50;

  // Weights depend on whether person has public stock
  let backedScore;
  if (hasPublicTicker) {
    backedScore = (stockScore * 0.40) + (newsScore * 0.40) + (communityScore * 0.20);
  } else {
    // No stock: reweight to news 60%, community 40%
    backedScore = (newsScore * 0.60) + (communityScore * 0.40);
  }

  return {
    stockScore: Math.round(stockScore * 10) / 10,
    newsScore: Math.round(newsScore * 10) / 10,
    backedScore: Math.round(backedScore * 10) / 10,
  };
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  // Verify we have necessary env vars
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results = [];
  const errors = [];

  console.log(`Starting score update for ${ROSTER.length} people...`);

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < ROSTER.length; i += 5) {
    const batch = ROSTER.slice(i, i + 5);

    const batchResults = await Promise.all(batch.map(async (person) => {
      try {
        const hasPublicTicker = !!person.ticker && !person.ticker.includes('.');
        // Only fetch US tickers (Finnhub free tier limitation)
        const stockData = hasPublicTicker ? await fetchStockQuote(person.ticker) : null;
        const newsData = await fetchNewsForPerson(person.name, person.company);
        const scores = calculateBackedScore(stockData, newsData, hasPublicTicker);

        return {
          person_id: person.id,
          stock_price: stockData?.price || null,
          stock_change_pct: stockData?.change || 0,
          sentiment_score: newsData.sentiment,
          backed_score: scores.backedScore,
          updated_at: new Date().toISOString(),
        };
      } catch (e) {
        errors.push({ person: person.id, error: e.message });
        return null;
      }
    }));

    results.push(...batchResults.filter(Boolean));

    // Small delay between batches to respect rate limits
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

  // Also update community stats (total drafters + tokens per person)
  try {
    const { data: teamMembers } = await sb
      .from('team_members')
      .select('person_id, tokens_allocated');

    if (teamMembers && teamMembers.length > 0) {
      const stats = {};
      teamMembers.forEach(tm => {
        if (!stats[tm.person_id]) stats[tm.person_id] = { tokens: 0, drafters: 0 };
        stats[tm.person_id].tokens += tm.tokens_allocated;
        stats[tm.person_id].drafters += 1;
      });

      for (const [personId, s] of Object.entries(stats)) {
        await sb.from('scores_cache').update({
          total_tokens_allocated: s.tokens,
          total_drafters: s.drafters,
        }).eq('person_id', personId);
      }
    }
  } catch (e) {
    console.error('Community stats update failed:', e.message);
  }

  console.log(`Score update complete. ${results.length} updated, ${errors.length} errors.`);

  return res.status(200).json({
    updated: results.length,
    errors: errors.length,
    results: results.map(r => ({ id: r.person_id, score: r.backed_score, stock: r.stock_change_pct })),
    ...(errors.length > 0 ? { errorDetails: errors } : {}),
  });
}
