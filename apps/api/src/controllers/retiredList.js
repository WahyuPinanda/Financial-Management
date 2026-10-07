function retiredList(req, res) {
  res.status(410).json({
    status: false,
    message:
      'Gunakan /api/workspace dengan filter dan cursor. Pembacaan seluruh riwayat sekaligus tidak tersedia.',
  });
}
module.exports = { retiredList };
