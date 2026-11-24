export const serviceCategories = {
  alteration: 'Permak & ukuran',
  repair: 'Perbaikan',
  custom: 'Jahit baru',
  other: 'Layanan lainnya'
};

export function catalogFilters(query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
  const category = typeof query.category === 'string' && Object.hasOwn(serviceCategories, query.category)
    ? query.category : '';
  return { search, category };
}
