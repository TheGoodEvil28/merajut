const states = {
  NEW: 'Permintaan baru', NEEDS_DETAILS: 'Butuh klarifikasi', UNDER_REVIEW: 'Dalam peninjauan',
  QUOTED: 'Menunggu persetujuan', ACCEPTED: 'Disetujui', DECLINED: 'Ditolak', CANCELLED: 'Dibatalkan',
  REJECTED: 'Ditolak', SUPERSEDED: 'Digantikan', EXPIRED: 'Kedaluwarsa', WITHDRAWN: 'Ditarik',
  SENT: 'Menunggu persetujuan', CONFIRMED: 'Diterima', IN_PROGRESS: 'Sedang dikerjakan',
  READY: 'Siap diambil', COMPLETED: 'Selesai', QUEUED: 'Dalam antrean', SENDING: 'Sedang diproses',
  RETRY_WAIT: 'Menunggu percobaan ulang', SIMULATED: 'Notifikasi simulasi', FAILED: 'Gagal',
  SUPPRESSED: 'Tidak dikirim', NEEDS_REVIEW: 'Perlu ditinjau', PROCESSED: 'Diproses',
  AUTOMATED: 'Pengisian otomatis', AWAITING_CUSTOMER: 'Menunggu informasi pelanggan',
  AWAITING_HUMAN: 'Perlu ditangani', HUMAN: 'Sedang ditangani', RESOLVED: 'Percakapan selesai'
};
const events = {
  INQUIRY_CREATED: 'Permintaan dikirim', INQUIRY_UPDATED: 'Permintaan diperbarui', QUOTE_ISSUED: 'Penawaran dikirim',
  QUOTE_ACCEPTED: 'Penawaran disetujui', QUOTE_REJECTED: 'Penawaran ditolak', ORDER_CONFIRMED: 'Pesanan diterima',
  ORDER_UPDATED: 'Status pesanan diperbarui',
  QUOTE_EXPIRED:'Penawaran kedaluwarsa', CANCEL_REVIEW:'Pembatalan diajukan',
  CANCEL_APPROVED:'Pembatalan disetujui', CANCEL_DECLINED:'Pembatalan ditolak',
  CASH_RECORDED:'Penerimaan tunai dicatat', CASH_VOIDED:'Catatan tunai dikoreksi',
  INVITE_SENT:'Undangan dikirim', INVITE_ACCEPTED:'Undangan diterima',
  PUBLISHED:'Usaha dipublikasikan', UNPUBLISHED:'Usaha disembunyikan', ACCESS_REVOKED:'Akses penjahit dicabut',
  NOTICE_QUEUED:'Notifikasi diantrikan lagi', NOTICE_SIMULATED:'Bukti simulasi dicocokkan',
  NOTICE_SUPPRESSED:'Pengiriman ditutup'
};
const dateTime = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'
});
const localDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});

export const statusLabel = value => states[value] ?? value;
export const eventLabel = value => events[value] ?? value;
export const formatTime = value => dateTime.format(new Date(value)) + ' WIB';
export const formatDate = value => localDate.format(new Date(value));
