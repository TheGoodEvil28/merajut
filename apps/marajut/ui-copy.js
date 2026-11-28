const states = {
  OPEN:'Menunggu koordinasi admin', CONTACTED:'Menunggu jawaban mitra', AVAILABLE:'Mitra bersedia', UNAVAILABLE:'Mitra berhalangan',
  PENDING:'Menunggu pembayaran', PAID:'Lunas', NEW: 'Permintaan baru', NEEDS_DETAILS: 'Butuh klarifikasi', UNDER_REVIEW: 'Dalam peninjauan',
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
  DISPATCH_CONTACTED:'Admin menghubungi mitra', DISPATCH_AVAILABLE:'Mitra bersedia mengerjakan', DISPATCH_UNAVAILABLE:'Mitra berhalangan',
  GROUP_POSTED:'Admin membagikan pekerjaan ke grup', REASSIGNED:'Dialihkan ke mitra lain', PARTNER_SAVED:'Profil mitra disimpan',
  PAYMENT_STARTED:'Pembayaran dimulai', PAYMENT_PAID:'Pembayaran terverifikasi', PAYMENT_FAILED:'Pembayaran gagal',
  COMPLAINT_OPEN:'Keluhan diajukan', COMPLAINT_RESOLVED:'Keluhan ditanggapi',
  ORDER_UPDATED: 'Status pesanan diperbarui', ORDER_SHIPPED: 'Pesanan dikirim',
  TAILOR_START_PLANNED:'Rencana mulai dari mitra', TAILOR_PROGRESS:'Kabar pengerjaan dari mitra',
  TAILOR_FITTING_ACK:'Mitra siap untuk jadwal fitting', TAILOR_BLOCKED:'Mitra melaporkan kendala', TAILOR_RESUMED:'Pesanan dapat dilanjutkan',
  FITTING_CHANGE_REQUESTED:'Pelanggan meminta jadwal lain', FITTING_PROPOSED:'Jadwal fitting baru diusulkan',
  FITTING_CONFIRMED:'Pelanggan menyetujui jadwal fitting', FITTING_DONE:'Fitting selesai',
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
