import ApiKeysForm from '@/components/ApiKeysForm'
import { ApiKeysProvider } from '@/components/ApiKeysProvider'

export default function SettingsPage() {
  return (
    <ApiKeysProvider>
      <ApiKeysForm />
    </ApiKeysProvider>
  )
}
