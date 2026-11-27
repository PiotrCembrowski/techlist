/*
 * SYNTHETIC FIXTURES — not real Wikidata or Commons output. Shapes follow the Wikibase JSON
 * format and the MediaWiki Action API (wbgetentities, list=search, prop=imageinfo with
 * extmetadata), as seen on 2026-11-27; the items, IDs, labels, files and people are invented.
 */

export type Rank = "preferred" | "normal" | "deprecated";
export const item = (property: string, id: string, rank: Rank = "normal") => ({
  mainsnak: {
    snaktype: "value",
    property,
    datatype: "wikibase-item",
    datavalue: { type: "wikibase-entityid", value: { "entity-type": "item", id } },
  },
  rank,
});
export const str = (
  property: string,
  value: string,
  datatype = "string",
  rank: Rank = "normal",
) => ({
  mainsnak: { snaktype: "value", property, datatype, datavalue: { type: "string", value } },
  rank,
});
export const qty = (property: string, amount: string, unit: string | null) => ({
  mainsnak: {
    snaktype: "value",
    property,
    datatype: "quantity",
    datavalue: {
      type: "quantity",
      value: { amount, unit: unit ? `http://www.wikidata.org/entity/${unit}` : "1" },
    },
  },
  rank: "normal" as Rank,
});
export const time = (property: string, t: string, precision: number) => ({
  mainsnak: {
    snaktype: "value",
    property,
    datatype: "time",
    datavalue: { type: "time", value: { time: t, precision, timezone: 0 } },
  },
  rank: "normal" as Rank,
});
export const label = (value: string) => ({ en: { language: "en", value } });

export const ENTITY = {
  id: "Q990001",
  labels: label("Zorvik Pell 3"),
  descriptions: label("synthetic fixture smartphone model"),
  claims: {
    P31: [item("P31", "Q990100")],
    P279: [item("P279", "Q990101")],
    P176: [item("P176", "Q990200")],
    P179: [item("P179", "Q990300")],
    P13351: [str("P13351", "ZP3-A")],
    P3962: [str("P3962", "2000000050018", "external-id")],
    P577: [time("P577", "+2026-03-03T00:00:00Z", 11)],
    P18: [
      str("P18", "Zorvik Pell 3 back.jpg", "commonsMedia"),
      str("P18", "Zorvik Pell 3 front.jpg", "commonsMedia", "preferred"),
    ],
    P856: [str("P856", "https://zorvik.example/pell-3", "url")],
    P990010: [qty("P990010", "+128", "Q990901")],
    P990011: [qty("P990011", "+4500", "Q990902")],
    P990012: [qty("P990012", "+1", "Q990999")], // unit without a label: dropped, never guessed
    P990013: [item("P990013", "Q990400")],
    P990014: [time("P990014", "+2026-01-01T00:00:00Z", 10)],
    P990015: [str("P990015", "ZP3-ID", "external-id")], // external IDs are not features
    // Several values (e.g. per configuration): not merged into one feature.
    P990017: [qty("P990017", "+128", "Q990901"), qty("P990017", "+256", "Q990901")],
    P990016: [
      {
        mainsnak: { snaktype: "novalue", property: "P990016", datatype: "string" },
        rank: "normal",
      },
    ],
  },
};
export const LABELS = {
  Q990100: { id: "Q990100", labels: label("product model") },
  Q990101: { id: "Q990101", labels: label("fixture smartphone") },
  Q990200: { id: "Q990200", labels: label("Zorvik") },
  Q990300: { id: "Q990300", labels: label("Pell") },
  Q990400: { id: "Q990400", labels: label("Fixture OS 3") },
  Q990901: { id: "Q990901", labels: label("gigabyte") },
  Q990902: { id: "Q990902", labels: label("milliampere hour") },
  Q990999: { id: "Q990999" },
  P990010: { id: "P990010", labels: label("storage capacity") },
  P990011: { id: "P990011", labels: label("battery capacity") },
  P990012: { id: "P990012", labels: label("fixture count") },
  P990013: { id: "P990013", labels: label("operating system") },
  P990014: { id: "P990014", labels: label("inception") },
  P990017: { id: "P990017", labels: label("configurable storage") },
};
export const IMAGEINFO = {
  batchcomplete: true,
  query: {
    pages: [
      {
        title: "File:Zorvik Pell 3 front.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/f/f0/Zorvik_Pell_3_front.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
            width: 3000,
            height: 4000,
            thumburl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Zorvik_Pell_3_front.jpg/960px-Zorvik_Pell_3_front.jpg",
            thumbwidth: 960,
            thumbheight: 1280,
            mime: "image/jpeg",
            extmetadata: {
              Artist: {
                value: '<a href="//commons.wikimedia.org/wiki/User:Fixture">A. Fixture</a>',
              },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
              AttributionRequired: { value: "true" },
              Restrictions: { value: "trademarked" },
            },
          },
        ],
      },
    ],
  },
};
