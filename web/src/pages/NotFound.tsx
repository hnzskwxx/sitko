import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../components/ui';
import { useDocumentTitle } from '../hooks';

export function NotFoundPage({ what = 'Stránka' }: { what?: string }) {
  useDocumentTitle('Nenalezeno');
  return (
    <div className="page">
      <EmptyState icon={<SearchX />} title={`${what} neexistuje`} actions={<Link to="/" className="btn btn-secondary">Zpět na přehled</Link>}>
        Mohla být smazána, nebo k ní nemáte přístup.
      </EmptyState>
    </div>
  );
}
