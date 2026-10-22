import { configureStore } from '@reduxjs/toolkit'
import { api } from './api'

export const makeStore = () => configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: (d) => d().concat(api.middleware) })
export type AppStore = ReturnType<typeof makeStore>
