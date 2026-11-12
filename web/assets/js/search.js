/* Guiyan client search — Wave 4 #14, port of zhou guiyan-demo/src/search.js
   (58 lines, client-side only). matchesSearch() + the 6 alias groups (14
   words, kept as-is: Guangxi culture vocabulary matching Lam's data) + the
   13-word lexicon. The lexicon is only used to split query tokens; five of
   its words (织锦 / 抛绣球 / 民歌 / 非物质文化遗产 / 文化创意) do not occur
   in Lam's data, but they are kept — splitting on an absent word invents
   no data. Plain JS (no JSX) so node:test can import it directly.
   No server search change: the server ILIKE stays as-is.
   Haystack for Lam: name + city + catZh(category) + description (current
   language) + tags. Tags come from APIRES (see App.jsx); a resource that
   only exists in the offline fallback catalog simply has no tags here. */
const aliases = [
  ["壮锦", "织锦", "织造"],
  ["绣球", "抛绣球"],
  ["山歌", "民歌"],
  ["非遗", "非物质文化遗产"],
  ["文创", "文化创意"],
  ["场馆", "场地", "剧场"],
];
const lexicon = [
  ...new Set([
    ...aliases.flat(),
    "南宁",
    "柳州",
    "桂林",
    "北海",
    "崇左",
    "河池",
    "演出",
    "音乐会",
    "亲子",
    "设备",
    "艺人",
    "租赁",
    "体验",
  ]),
].sort((a, b) => b.length - a.length);
const splitWords = new RegExp("(" + lexicon.join("|") + ")", "g");
export function matchesSearch(resource, query) {
  const text = [
    resource.name,
    resource.description,
    resource.city,
    resource.category,
    ...(resource.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  const tokens = String(query || "")
    .trim()
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .flatMap((token) =>
      text.includes(token) ? [token] : token.split(splitWords).filter(Boolean),
    );
  return tokens.every((token) => {
    const group = aliases.find((g) => g.includes(token));
    return (group || [token]).some((word) => text.includes(word));
  });
}
