import {script} from '@digshare/script';
import * as Cheerio from 'cheerio';
import Decimal from 'decimal.js';
import fetch from 'node-fetch';

process.env.TZ = 'Asia/Shanghai';

const MONITORING_CURRENCY_MAP = new Map(
  ['美元', '欧元', '英镑', '日元'].map((currency, index) => [currency, index]),
);

const DAILY_OFFSET = 9 * 3600 * 1000 - 2 * 60 * 1000; // 9:00 向前宽限 2 分钟

const CHANGE_RATE_THRESHOLD = 0.005;

interface Storage {
  dailySent: string;
  rates: Record<string, number | undefined>;
}

export default script<undefined, Storage>(async function* (
  _payload,
  {storage},
) {
  let html = await fetch('https://www.boc.cn/sourcedb/whpj/index.html').then(
    response => response.text(),
  );

  let $ = Cheerio.load(html);

  let table = $('.BOC_main > .publish table')[1];

  let entries = $('tr', table)
    .toArray()
    .slice(1)
    .map(tr => {
      let tds = $('td', tr);

      let currency = $(tds[0]).text().trim();

      let buying = parseRate(
        $(tds[1]).text().trim() || $(tds[2]).text().trim(),
      );
      let selling = parseRate(
        $(tds[3]).text().trim() || $(tds[4]).text().trim(),
      );
      let ref = parseRate($(tds[4]).text().trim());

      return {
        currency,
        buying,
        selling,
        ref,
      };
    })
    .filter(entry => MONITORING_CURRENCY_MAP.has(entry.currency))
    .sort(
      (a, b) =>
        MONITORING_CURRENCY_MAP.get(a.currency)! -
        MONITORING_CURRENCY_MAP.get(b.currency)!,
    );

  let rates = storage.getItem('rates') ?? {};

  let nowDate = new Date();
  let todayDate = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  );

  let todayDateString = nowDate.toDateString();

  if (
    storage.getItem('dailySent') !== todayDateString &&
    nowDate.getTime() - todayDate.getTime() > DAILY_OFFSET
  ) {
    storage.setItem('dailySent', todayDateString);

    let previousRates = {...rates};

    for (let {currency, ref} of entries) {
      rates[currency] = ref;
    }

    storage.setItem('rates', rates);

    yield {
      content: `\
每日汇率简报：

${entries
  .map(
    ({currency, buying, selling, ref}) =>
      `${currency}：${ref}（波动 ${getChangeRatePercentage(
        ref,
        previousRates[currency],
      )}，买 ${buying}，卖 ${selling}）`,
  )
  .join('\n')}`,
    };
  }

  for (let {currency, buying, selling, ref} of entries) {
    let previousRate = rates[currency];

    if (typeof previousRate !== 'number') {
      continue;
    }

    let changeRate = (ref - previousRate) / previousRate;

    if (Math.abs(changeRate) < CHANGE_RATE_THRESHOLD) {
      continue;
    }

    rates[currency] = ref;

    storage.setItem('rates', rates);

    yield {
      content: `\
${
  changeRate > 0 ? '📈' : '📉'
}${currency}当前汇率 ${ref}（买 ${buying}，卖 ${selling}），较上次推送 ${
        changeRate > 0 ? '+' : '-'
      }${(changeRate * 100).toFixed(2)}%。`,
      tags: [currency],
    };
  }
});

function parseRate(rate: string): number {
  return rate ? new Decimal(rate).div(100).toNumber() : NaN;
}

function getChangeRatePercentage(
  current: number,
  previous: number | undefined,
): string {
  if (typeof previous !== 'number') {
    return 'N/A';
  }

  let changeRate = (current - previous) / previous;

  return `${changeRate >= 0 ? '+' : '-'}${(changeRate * 100).toFixed(2)}%`;
}
