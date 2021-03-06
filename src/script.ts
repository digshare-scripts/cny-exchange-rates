import {script} from '@digshare/script';
import * as Cheerio from 'cheerio';
import Decimal from 'decimal.js';
import fetch from 'node-fetch';

process.env.TZ = 'Asia/Shanghai';

const MONITORING_CURRENCIES = [
  '美元',
  '欧元',
  '英镑',
  '港币',
  '日元',
  '卢布',
  '土耳其里拉',
  '澳大利亚元',
];

const MONITORING_CURRENCY_MAP = new Map(
  MONITORING_CURRENCIES.map((currency, index) => [currency, index]),
);

const DAILY_OFFSET = 9 * 3600 * 1000 - 2 * 60 * 1000; // 9:00 向前宽限 2 分钟

const CHANGE_RATE_THRESHOLD_MAP = new Map([
  ...MONITORING_CURRENCIES.map(currency => [currency, 0.01] as const),
  ['卢布', 0.05],
]);

interface Storage {
  dailySent: string;
  rates: Record<string, number | [number, number] | undefined>;
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
      let rate = (buying + selling) / 2;

      return {
        currency,
        buying,
        selling,
        rate,
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

    for (let {currency, rate} of entries) {
      rates[currency] = rate;
    }

    storage.setItem('rates', rates);

    yield {
      content: `\
每日汇率简报：

${entries
  .map(({currency, buying, selling, rate}) => {
    let previousRate = previousRates[currency];

    if (Array.isArray(previousRate)) {
      // 取简报的汇率
      previousRate = previousRate[0];
    }

    return `${currency}：买 ${buying}，卖 ${selling}，波动 ${getChangeRatePercentage(
      rate,
      previousRate,
    )}`;
  })
  .join('\n')}`,
    };
  }

  for (let {currency, buying, selling, rate} of entries) {
    let previousRate = rates[currency];
    let previousDailyRate: number | undefined;

    if (Array.isArray(previousRate)) {
      // 优先取简报后变过的汇率
      [previousDailyRate, previousRate] = previousRate;
    } else {
      if (typeof previousRate !== 'number') {
        continue;
      }

      previousDailyRate = previousRate;
    }

    let changeRate = (rate - previousRate) / previousRate;

    if (Math.abs(changeRate) < CHANGE_RATE_THRESHOLD_MAP.get(currency)!) {
      continue;
    }

    rates[currency] = [previousDailyRate, rate];

    storage.setItem('rates', rates);

    yield {
      content: `\
${
  changeRate > 0 ? '📈' : '📉'
}${currency}当前买 ${buying}，卖 ${selling}，较上次推送 ${
        changeRate > 0 ? '+' : ''
      }${(changeRate * 100).toFixed(2)}%。

如果不想收到特定币种的波动速报，可以在订阅设置中取消“接受全部消息”后按需选择。`,
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

  return `${changeRate >= 0 ? '+' : ''}${(changeRate * 100).toFixed(2)}%`;
}
