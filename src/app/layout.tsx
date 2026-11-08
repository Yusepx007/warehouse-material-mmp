import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../../styles.css';

export const metadata: Metadata = {
  title: 'Warehouse Material MMP',
  description: 'Sistem Manajemen Material Gudang MMP',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
