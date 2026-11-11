/* Category table for the admin dashboard only — copied verbatim from
   web/assets/js/data.js:205-216 (the CATS table the customer site uses).
   The admin page used to import catZh from data.js, which pulled the
   whole 866 KB data.js (i18n in 3 languages + base64 CATIMG) into the
   admin bundle as a separate chunk ~23x the dashboard code itself.
   This file carries only the 10-row table, so the dashboard chunk stays
   ~37 KB. The admin UI is always Chinese (zh), so catZh here is pure:
   it returns the Chinese name CATS[i][1] and never touches the web
   langState singleton. Unknown ids fall back to the id itself, exactly
   like the original. */
var CATS = [
  ["show","演出剧目","Vở diễn & kịch mục","Shows"],
  ["venue","演出场馆","Nhà hát & sân khấu","Venues"],
  ["artist","艺人团队","Nghệ nhân & đoàn diễn","Artists"],
  ["equipment","设备租赁","Thuê thiết bị","Equipment"],
  ["copyright","版权与IP","Bản quyền & IP","IP & licensing"],
  ["heritage","非遗体验","Di sản phi vật thể","Heritage"],
  ["creative","文创衍生","Văn sáng & quà tặng","Creative goods"],
  ["digital","数字演出","Diễn số & nhập vai","Digital shows"],
  ["tourism","文旅套餐","Gói văn–du","Travel packages"],
  ["service","配套服务","Dịch vụ hỗ trợ","Services"]
];

export function catZh(id) {
  for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === id) return CATS[i][1];
  return id;
}

export { CATS };
