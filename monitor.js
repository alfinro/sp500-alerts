import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const instruments = [
  {
    id: 'sp500',
    name: 'S&P 500 Futures',
    url: 'https://www.investing.com/indices/us-spx-500-futures',
    selector: '.text-5xl span[data-test="instrument-price-last"]'
  },
  {
    id: 'vix',
    name: 'VIX (Volatility S&P500)',
    url: 'https://www.investing.com/indices/volatility-s-p-500',
    selector: '.text-5xl span[data-test="instrument-price-last"]'
  }
];

const thresholds = {
  '15m': 0.1,
  '30m': 0.11,
  '60m': 0.2,
  '1440m': 2.5
};

const priceHistory = {};

const getPrice = async (url, selector) => {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(res.data);
    const priceText = $(selector).first().text().replace(',', '');
    return parseFloat(priceText);
  } catch (err) {
    console.error(`Eroare la fetch ${url}:`, err.message);
    return null;
  }
};

const calculateChange = (history, minutes) => {
  const now = Date.now();
  const past = history.find(p => p.time <= now - minutes * 60 * 1000);
  if (!past) return 0;
  const latest = history[history.length - 1].price;
  return ((latest - past.price) / past.price) * 100;
};

const checkAlerts = (id, name) => {
  const history = priceHistory[id];
  if (!history || history.length < 2) return;

  for (const [period, threshold] of Object.entries(thresholds)) {
    const minutes = parseInt(period);
    const change = calculateChange(history, minutes);
    if (Math.abs(change) >= threshold) {
      io.emit('alert', {
        name,
        change: change.toFixed(2),
        period,
        direction: change > 0 ? 'up' : 'down',
        time: new Date().toLocaleTimeString()
      });
      console.log(`⚠️ ALERT: ${name} ${change.toFixed(2)}% în ${period}`);
    }
  }
};

const updatePrices = async () => {
  for (const inst of instruments) {
    const price = await getPrice(inst.url, inst.selector);
    if (!price) continue;

    const now = Date.now();
    if (!priceHistory[inst.id]) priceHistory[inst.id] = [];
    priceHistory[inst.id].push({ price, time: now });

    priceHistory[inst.id] = priceHistory[inst.id].filter(p => p.time >= now - 2 * 60 * 60 * 1000);

    checkAlerts(inst.id, inst.name);
  }
};

setInterval(updatePrices, 60 * 1000);
updatePrices();

server.listen(PORT, () => {
  console.log(`✅ Server pornit pe portul ${PORT}`);
});
