import { redirect } from 'next/navigation'

export default function AddressesRedirect() {
  redirect('/admin/users')
}
