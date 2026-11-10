// Local storage for the demo: language, favorites and orders live on the
// phone only. No account, no server, no real payment.
function load(key, def) {
  try {
    var v = wx.getStorageSync(key);
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) { return def; }
}
function save(key, v) {
  try { wx.setStorageSync(key, v); } catch (e) {}
}

var ORDERS_KEY = 'guiyan-orders';
var FAVS_KEY = 'guiyan-favs';

function getOrders() { return load(ORDERS_KEY, []); }
function saveOrders(list) { save(ORDERS_KEY, list); }
function getFavs() { return load(FAVS_KEY, []); }
function saveFavs(list) { save(FAVS_KEY, list); }
function isFav(idx) { return getFavs().indexOf(idx) !== -1; }
function toggleFav(idx) {
  var f = getFavs();
  var i = f.indexOf(idx);
  if (i === -1) f.push(idx); else f.splice(i, 1);
  saveFavs(f);
  return f.indexOf(idx) !== -1;
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function newOrder(idx, qty, date, total) {
  var d = new Date();
  var code = 'GY' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
    + String(Math.floor(1000 + Math.random() * 9000));
  return { code: code, idx: idx, qty: qty, date: date, total: total,
           status: 'pending', createdAt: d.getTime() };
}
function addOrder(o) {
  var list = getOrders();
  list.unshift(o);
  saveOrders(list);
  return o;
}
function updateOrder(code, status) {
  var list = getOrders();
  for (var i = 0; i < list.length; i++) {
    if (list[i].code === code) list[i].status = status;
  }
  saveOrders(list);
  return list;
}

module.exports = {
  getOrders: getOrders, saveOrders: saveOrders, getFavs: getFavs,
  saveFavs: saveFavs, isFav: isFav, toggleFav: toggleFav,
  newOrder: newOrder, addOrder: addOrder, updateOrder: updateOrder
};
