import ReconciliationClient from './ReconciliationClient'

export default function ReconciliationPage({ params }: { params: { id: string } }) {
  return <ReconciliationClient statementId={params.id} />
}
