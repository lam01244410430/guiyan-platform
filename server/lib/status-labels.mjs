// Shared Chinese labels for order statuses (B-038): user-visible text must
// never embed a raw English status code. Same words as
// admin/assets/js/adminApi.js STATUS and the H5 st* i18n keys.
export const ORDER_STATUS_ZH = {
  pending: "待确认",
  confirmed: "已确认",
  paid: "已支付",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款",
  refund_requested: "退款申请中",
  disputed: "纠纷处理中",
};
