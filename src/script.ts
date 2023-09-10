import {script} from '@digshare/script';

import {getRates} from './@boc';

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

const THRESHOLD_FACTOR = 2;

const DAILY_OFFSET = 9 * 3600 * 1000 - 2 * 60 * 1000; // 9:00 向前宽限 2 分钟

interface State {
  dailySent: string | null;
  rates: Record<
    string,
    [
      [rate: number, timestamp: number][],
      dailyRate: number | null,
      reportedRate: number | null,
    ]
  >;
}

export default script<State>(async function* (
  {dailySent, rates} = {dailySent: null, rates: {}},
) {
  // migration
  for (const [currency, rate] of Object.entries(rates) as [string, any][]) {
    if (typeof rate === 'number') {
      rates[currency] = [[], rate, rate];
    } else if (Array.isArray(rate) && rate.length === 2) {
      rates[currency] = [[], rate[0], rate[0]];
    }
  }

  let updated = false;

  const nowDate = new Date();
  const now = nowDate.getTime();

  const oneDayAgo = now - 24 * 3600 * 1000;
  const oneWeekAgo = now - 7 * 24 * 3600 * 1000;

  const latestRates = await getRates();

  const latestRateMap = new Map(latestRates.map(rate => [rate.currency, rate]));

  for (const {currency, rate} of latestRates) {
    const [rateRecords] =
      rates[currency] ?? (rates[currency] = [[], null, null]);

    const lastRate = rateRecords[rateRecords.length - 1]?.[0];

    if (rate !== lastRate) {
      rateRecords.push([rate, now]);
    }

    const firstIndexWithinOneWeek = rateRecords.findIndex(
      ([, timestamp]) => timestamp > oneWeekAgo,
    );

    rateRecords.splice(0, firstIndexWithinOneWeek);
  }

  const todayDate = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  );

  const todayDateString = nowDate.toDateString();

  if (
    todayDateString !== dailySent &&
    nowDate.getTime() - todayDate.getTime() > DAILY_OFFSET
  ) {
    dailySent = todayDateString;

    const previousDailyRates = Object.fromEntries(
      Object.entries(rates).map(([currency, [, dailyRate]]) => [
        currency,
        dailyRate,
      ]),
    );

    updated = true;

    yield {
      message: `\
每日汇率简报：

${MONITORING_CURRENCIES.map(currency => {
  const previousDailyRate = previousDailyRates[currency];
  const latestRate = latestRateMap.get(currency);

  if (!latestRate) {
    return `- ${currency}：无数据`;
  }

  const {buying, selling, rate} = latestRate;

  const record = rates[currency];

  record[1] = record[2] = rate;

  return `- ${currency}：买 ${buying}，卖 ${selling}，波动 ${getChangeRatePercentage(
    rate,
    previousDailyRate,
  )}`;
}).join('\n')}`,
      state: {
        dailySent: todayDateString,
        rates,
      },
    };
  }

  for (const currency of MONITORING_CURRENCIES) {
    const record = rates[currency];

    if (!record) {
      continue;
    }

    const [rateRecords, , reportedRate] = record;

    if (typeof reportedRate !== 'number') {
      continue;
    }

    if (rateRecords.length < 2) {
      continue;
    }

    if (rateRecords[0][1] > oneDayAgo) {
      continue;
    }

    if (rateRecords[rateRecords.length - 1][1] < now) {
      continue;
    }

    const previousRates = rateRecords.map(([rate]) => rate);
    const latestRate = previousRates.pop()!;

    const maxRate = Math.max(...previousRates);
    const minRate = Math.min(...previousRates);

    const previousMaxRateChange = maxRate / minRate - 1;

    const rateChange =
      Math.abs(latestRate - reportedRate) / Math.min(latestRate, reportedRate);

    if (rateChange < previousMaxRateChange * THRESHOLD_FACTOR) {
      continue;
    }

    record[2] = latestRate;

    const {buying, selling} = latestRateMap.get(currency)!;

    const icon = rateChange > 0 ? '📈' : '📉';
    const changeText = `${rateChange > 0 ? '+' : ''}${(
      rateChange * 100
    ).toFixed(2)}%`;

    updated = true;

    yield {
      message: {
        content: `\
${icon}${currency}当前买 ${buying}，卖 ${selling}，较上次推送 ${changeText}。

如果不想收到特定币种的波动速报，可以在订阅设置中按需选择。`,
        tags: [currency],
      },
      state: {
        dailySent,
        rates,
      },
    };
  }

  if (!updated) {
    yield {
      state: {
        dailySent,
        rates,
      },
    };
  }
});

function getChangeRatePercentage(
  current: number,
  previous: number | null,
): string {
  if (typeof previous !== 'number') {
    return 'N/A';
  }

  const changeRate = (current - previous) / previous;

  return `${changeRate >= 0 ? '+' : ''}${(changeRate * 100).toFixed(2)}%`;
}
