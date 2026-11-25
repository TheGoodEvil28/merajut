export const orderReference = id => id.slice(0,8).toUpperCase();

export const handoverLabels = {
  pickup: 'Ambil di tempat penjahit',
  delivery: 'Kirim ke alamat pelanggan'
};

export const fittingLabels = {
  SCHEDULED: 'Jadwal disepakati',
  REQUESTED: 'Menunggu jadwal pengganti',
  PROPOSED: 'Menunggu konfirmasi pelanggan',
  DONE: 'Fitting selesai'
};

export const milestones = ['Permintaan', 'Penawaran', 'Pengerjaan', 'Pembayaran', 'Serah terima'];

const stages = {
  NEW: {
    label:'Permintaan baru', step:0, tone:'neutral',
    customer:['Permintaan sudah masuk', 'Admin akan menghubungi penjahit pilihan Anda dan menyiapkan penawaran.', 'Lihat detail permintaan', '#detail'],
    admin:['Hubungi penjahit', 'Kirim ringkasan permintaan dan tanyakan apakah penjahit bisa mengerjakannya.', 'Buka koordinasi', '#koordinasi']
  },
  CONTACTED: {
    label:'Menunggu jawaban penjahit', step:0, tone:'neutral',
    customer:['Admin sudah menghubungi penjahit', 'Harga dan perkiraan selesai akan muncul setelah penjahit memberi jawaban.'],
    admin:['Catat jawaban penjahit', 'Periksa balasan WhatsApp dan catat kesediaannya sebelum mengirim penawaran.', 'Catat jawaban', '#koordinasi']
  },
  UNAVAILABLE: {
    label:'Penjahit berhalangan', step:0, tone:'attention',
    customer:['Pilih penjahit pengganti', 'Permintaan, ukuran, dan foto bisa digunakan kembali untuk pilihan baru.', 'Lihat pilihan penjahit', '#ganti-penjahit'],
    admin:['Cari penjahit pengganti', 'Pilih mitra yang sesuai atau tunggu pelanggan menentukan pilihan.', 'Lihat pilihan penjahit', '#ganti-penjahit']
  },
  NEEDS_DETAILS: {
    label:'Butuh detail tambahan', step:0, tone:'attention',
    customer:['Lengkapi permintaan', 'Jawab pertanyaan admin agar penjahit bisa memperkirakan biaya dan waktu pengerjaan.', 'Jawab pertanyaan', '#klarifikasi'],
    admin:['Menunggu detail pelanggan', 'Jawaban pelanggan akan muncul di sini.', 'Lihat pertanyaan', '#klarifikasi']
  },
  DRAFT_QUOTE: {
    label:'Penawaran disiapkan', step:1, tone:'active',
    customer:['Admin sedang menyiapkan penawaran', 'Anda dapat meninjau harga, waktu selesai, dan opsi serah terima sebelum menyetujui.'],
    admin:['Harga dan jadwal siap dicatat', 'Masukkan harga yang disepakati dengan penjahit, perkiraan selesai, dan jadwal fitting jika diperlukan.', 'Susun penawaran', '#editor-penawaran']
  },
  QUOTED: {
    label:'Penawaran siap ditinjau', step:1, tone:'attention',
    customer:['Tinjau penawaran penjahit', 'Periksa total harga, tanggal selesai, dan cara serah terima sebelum menyetujui.', 'Tinjau penawaran', '#penawaran'],
    admin:['Menunggu keputusan pelanggan', 'Pelanggan dapat menyetujui, menolak, atau meminta penyesuaian melalui halaman pesanan.', 'Lihat penawaran', '#penawaran']
  },
  REJECTED: {
    label:'Penawaran ditolak', step:1, tone:'attention',
    customer:['Tentukan langkah berikutnya', 'Anda bisa memilih penjahit lain atau menunggu penawaran baru dari admin.', 'Pilih penjahit lain', '#ganti-penjahit'],
    admin:['Tindak lanjuti penolakan', 'Bahas harga atau jadwal baru dengan penjahit, atau pilih mitra pengganti.', 'Revisi penawaran', '#editor-penawaran']
  },
  EXPIRED: {
    label:'Penawaran kedaluwarsa', step:1, tone:'attention',
    customer:['Menunggu penawaran terbaru', 'Admin akan memeriksa kembali harga dan jadwal penjahit.'],
    admin:['Perbarui penawaran', 'Konfirmasi kembali harga dan jadwal dengan penjahit sebelum mengirim versi baru.', 'Revisi penawaran', '#editor-penawaran']
  },
  CONFIRMED: {
    label:'Pesanan disetujui', step:2, tone:'active',
    customer:['Harga dan pengerjaan disepakati', 'Admin akan memberi kabar saat penjahit mulai bekerja. Pembayaran dibuka saat jahitan siap.'],
    admin:['Konfirmasi mulai pengerjaan', 'Perbarui status setelah penjahit mulai mengerjakan pesanan.', 'Mulai pengerjaan', '#pengerjaan']
  },
  FITTING: {
    label:'Fitting terjadwal', step:2, tone:'active',
    customer:['Datang sesuai jadwal fitting', 'Periksa waktu dan lokasi untuk pengukuran atau mencoba pakaian.', 'Lihat jadwal fitting', '#fitting'],
    admin:['Pantau janji fitting', 'Catat setelah pelanggan selesai fitting atau ajukan jadwal baru jika perlu.', 'Kelola fitting', '#fitting']
  },
  FITTING_PAST: {
    label:'Waktu fitting sudah lewat', step:2, tone:'attention',
    customer:['Periksa jadwal fitting', 'Jika pertemuan belum terjadi, minta waktu lain dari halaman ini.', 'Lihat jadwal fitting', '#fitting'],
    admin:['Tindak lanjuti fitting', 'Hubungi penjahit untuk mencatat hasil pertemuan atau mengatur waktu baru.', 'Kelola fitting', '#fitting']
  },
  FITTING_CHANGE: {
    label:'Fitting perlu dijadwalkan ulang', step:2, tone:'attention',
    customer:['Menunggu usulan jadwal baru', 'Admin akan mencocokkan waktu Anda dengan penjahit.', 'Lihat fitting', '#fitting'],
    admin:['Ajukan jadwal fitting baru', 'Cocokkan waktu dengan penjahit, lalu kirim tanggal dan lokasi untuk dikonfirmasi pelanggan.', 'Atur jadwal fitting', '#fitting']
  },
  FITTING_PROPOSED: {
    label:'Jadwal fitting perlu dikonfirmasi', step:2, tone:'attention',
    customer:['Periksa jadwal fitting baru', 'Setujui waktu yang diusulkan atau minta jadwal lain.', 'Tinjau jadwal fitting', '#fitting'],
    admin:['Menunggu konfirmasi fitting', 'Pelanggan sedang meninjau waktu dan lokasi yang diusulkan.', 'Lihat jadwal fitting', '#fitting']
  },
  IN_PROGRESS: {
    label:'Sedang dijahit', step:2, tone:'active',
    customer:['Penjahit sedang mengerjakan pesanan', 'Anda dapat melihat perkiraan selesai di rincian pesanan.'],
    admin:['Catat saat jahitan siap', 'Setelah penjahit memberi kabar bahwa pekerjaan selesai, buka tagihan untuk pelanggan.', 'Perbarui pengerjaan', '#pengerjaan']
  },
  DUE: {
    label:'Siap dibayar', step:3, tone:'attention',
    customer:['Jahitan sudah siap', 'Bayar sesuai total yang Anda setujui agar admin bisa mengatur serah terima.', 'Buka pembayaran', '#pembayaran'],
    admin:['Menunggu pembayaran', 'Pelanggan bisa membuka tagihan dari halaman pesanannya.', 'Lihat tagihan', '#pembayaran']
  },
  PAYMENT_FAILED: {
    label:'Pembayaran perlu diulang', step:3, tone:'attention',
    customer:['Coba pembayaran lagi', 'Tagihan sebelumnya sudah tidak berlaku. Mulai pembayaran baru dari pesanan ini.', 'Ulangi pembayaran', '#pembayaran'],
    admin:['Menunggu pembayaran ulang', 'Pelanggan dapat membuat tagihan baru untuk pesanan yang sama.', 'Lihat pembayaran', '#pembayaran']
  },
  PENDING: {
    label:'Menunggu verifikasi pembayaran', step:3, tone:'attention',
    customer:['Periksa pembayaran Anda', 'Ikuti petunjuk pembayaran dan cek kembali statusnya dari pesanan ini.', 'Lihat pembayaran', '#pembayaran'],
    admin:['Periksa pembayaran', 'Periksa status sebelum menyerahkan atau mengirim pakaian.', 'Periksa pembayaran', '#pembayaran']
  },
  PAYMENT_DISABLED: {
    label:'Pembayaran belum tersedia', step:3, tone:'attention',
    customer:['Pembayaran belum tersedia', 'Anda dapat kembali ke pesanan ini saat admin membuka pembayaran.', 'Lihat status', '#pembayaran'],
    admin:['Pembayaran perlu diperiksa', 'Periksa konfigurasi pembayaran sebelum meminta pelanggan membayar.', 'Lihat status', '#pembayaran']
  },
  PICKUP: {
    label:'Lunas · siap diambil', step:4, tone:'complete',
    customer:['Pesanan siap diambil', 'Ikuti kesepakatan pengambilan bersama penjahit.', 'Lihat rincian pengambilan', '#serah-terima'],
    admin:['Konfirmasi pengambilan', 'Tutup pesanan setelah pakaian diserahkan kepada pelanggan.', 'Catat serah terima', '#serah-terima']
  },
  DELIVERY: {
    label:'Lunas · siap dikirim', step:4, tone:'complete',
    customer:['Pesanan sedang disiapkan untuk dikirim', 'Admin akan menampilkan rincian pengiriman di halaman ini.', 'Lihat serah terima', '#serah-terima'],
    admin:['Catat pengiriman', 'Periksa alamat pelanggan dan simpan rincian kurir atau kabar pengantaran setelah paket dikirim.', 'Catat pengiriman', '#serah-terima']
  },
  SHIPPED: {
    label:'Dalam pengiriman', step:4, tone:'active',
    customer:['Pesanan sudah dikirim', 'Lihat rincian pengiriman di bawah.', 'Lacak pesanan', '#serah-terima'],
    admin:['Konfirmasi pesanan diterima', 'Tutup pesanan setelah pelanggan menerima pakaian.', 'Catat serah terima', '#serah-terima']
  },
  COMPLETE: {
    label:'Pesanan selesai', step:5, tone:'complete',
    customer:['Pesanan selesai', 'Rincian pengerjaan dan pembayaran tersimpan dalam riwayat.'],
    admin:['Pesanan selesai', 'Serah terima sudah tercatat.']
  },
  REASSIGNED: {
    label:'Dialihkan ke penjahit lain', tone:'neutral',
    customer:['Permintaan diteruskan', 'Pengajuan dan penawaran lama tersimpan di sini. Ikuti permintaan baru untuk kabar selanjutnya.', 'Buka permintaan baru', 'replacement'],
    admin:['Permintaan diteruskan', 'Lanjutkan koordinasi dari permintaan pengganti.', 'Buka permintaan baru', 'replacement']
  },
  CLOSED: {
    label:'Permintaan ditutup', tone:'neutral',
    customer:['Permintaan ini sudah ditutup', 'Anda dapat melihat riwayat atau mengajukan permintaan baru.'],
    admin:['Permintaan ditutup', 'Periksa riwayat untuk melihat keputusan terakhir.']
  }
};

function stageKey(item, paymentMode) {
  if (item.replacement_id) return 'REASSIGNED';
  const status = item.order_status ?? item.status;
  if (status === 'COMPLETED') return 'COMPLETE';
  if (['CANCELLED','DECLINED'].includes(status)) return 'CLOSED';
  if (status === 'READY') {
    if (item.shipped_at) return 'SHIPPED';
    if (item.payment_state === 'PAID') return item.handover === 'delivery' ? 'DELIVERY' : 'PICKUP';
    if (paymentMode === 'disabled' || (item.payment_state === 'PENDING' && paymentMode && item.payment_mode !== paymentMode)) {
      return 'PAYMENT_DISABLED';
    }
    return { PENDING:'PENDING', FAILED:'PAYMENT_FAILED' }[item.payment_state] ?? 'DUE';
  }
  if (['CONFIRMED','IN_PROGRESS'].includes(status)) {
    const reserved = ['SCHEDULED','PROPOSED'].includes(item.fitting_state);
    if (reserved && item.fitting_at && new Date(item.fitting_at)<=new Date()) return 'FITTING_PAST';
    return { SCHEDULED:'FITTING', REQUESTED:'FITTING_CHANGE', PROPOSED:'FITTING_PROPOSED' }[item.fitting_state] ?? status;
  }
  if (status === 'NEEDS_DETAILS') return status;
  if (item.quote_status === 'SENT' && status === 'QUOTED') return 'QUOTED';
  if (item.dispatch_state === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (item.quote_status === 'REJECTED') return 'REJECTED';
  if (status === 'EXPIRED' || (status === 'QUOTED' && item.quote_status === 'EXPIRED')) return 'EXPIRED';
  if (item.dispatch_state === 'AVAILABLE') return 'DRAFT_QUOTE';
  return item.dispatch_state === 'CONTACTED' ? 'CONTACTED' : 'NEW';
}

export function orderJourney(item, role, paymentMode) {
  const key = stageKey(item,paymentMode);
  const stage = stages[key];
  const [title,description,action,anchor] = stage[role];
  const href = anchor === 'replacement' ? '/requests/'+item.replacement_id : anchor;
  const group = ['COMPLETE','REASSIGNED','CLOSED'].includes(key) ? 'history'
    : ['NEEDS_DETAILS','UNAVAILABLE','REJECTED','QUOTED','FITTING_PROPOSED','FITTING_PAST','DUE','PAYMENT_FAILED'].includes(key)
      || (key === 'PENDING' && item.payment_mode !== 'demo') ? 'action' : 'ongoing';
  return { key, label:stage.label, step:stage.step, tone:stage.tone, title, description, action, href, group };
}
