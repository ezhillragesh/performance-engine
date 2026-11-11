import { currency, PAGE_SIZE, type Invoice } from './invoiceData'

export function InvoiceSummary({ invoices }: { invoices: Invoice[] }) {
  let total = 0
  let overdue = 0
  for (const invoice of invoices) {
    total += invoice.amount
    if (invoice.status === 'Overdue') overdue += 1
  }
  return (
    <dl className="invoice-summary">
      <div>
        <dt>Invoices</dt>
        <dd className="tabular">{invoices.length}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd className="tabular">{currency.format(total)}</dd>
      </div>
      <div>
        <dt>Overdue</dt>
        <dd className="tabular">{overdue}</dd>
      </div>
    </dl>
  )
}

export function InvoiceTable({ invoices, page }: { invoices: Invoice[]; page: number }) {
  const rows = invoices.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Customer</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((invoice) => (
            <tr key={invoice.id}>
              <td className="mono">{invoice.id}</td>
              <td className="truncate-cell">{invoice.customer}</td>
              <td className="num tabular">{currency.format(invoice.amount)}</td>
              <td>
                <span className={`tag tag--${invoice.status.toLowerCase()}`}>{invoice.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function InvoicePager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  return (
    <nav className="pager" aria-label="Invoice pages">
      <button type="button" className="button button--ghost button--sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span className="pager__label tabular">
        {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  )
}
