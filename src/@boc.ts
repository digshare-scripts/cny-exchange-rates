import * as Cheerio from 'cheerio';
import {Decimal} from 'decimal.js';

export interface Rate {
  currency: string;
  buying: number;
  selling: number;
  rate: number;
}

export async function getRates(): Promise<Rate[]> {
  const html = await fetch('https://www.boc.cn/sourcedb/whpj/index.html').then(
    response => response.text(),
  );

  const $ = Cheerio.load(html);

  const table = $('.BOC_main > .publish table')[1];

  return $('tr', table)
    .toArray()
    .slice(1)
    .map(tr => {
      const tds = $('td', tr);

      const currency = $(tds[0]).text().trim();

      const buying = parseRate(
        $(tds[1]).text().trim() || $(tds[2]).text().trim(),
      );
      const selling = parseRate(
        $(tds[3]).text().trim() || $(tds[4]).text().trim(),
      );

      const rate = buying.add(selling).div(2);

      return {
        currency,
        buying: buying.toNumber(),
        selling: selling.toNumber(),
        rate: rate.toNumber(),
      };
    });
}

function parseRate(rate: string): Decimal {
  return new Decimal(rate).div(100);
}
