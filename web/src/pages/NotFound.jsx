import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="nf">
      <div className="wrap">
        <h1>Route not declared</h1>
        <p>Like an undeclared route in a crashtest run, this URL isn&apos;t on the manifest.</p>
        <Link to="/" className="btn btn-primary">Back to the harness</Link>
      </div>
    </section>
  )
}
