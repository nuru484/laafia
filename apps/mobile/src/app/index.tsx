import { Redirect } from 'expo-router'
import { currentSession } from '../lib/runtime'

export default function Index() {
  return <Redirect href={currentSession()?.role === 'facility' ? '/inbox' : '/today'} />
}
