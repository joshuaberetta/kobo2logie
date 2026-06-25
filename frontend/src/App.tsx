import { Route, Routes } from 'react-router-dom'
import { FormPage } from './pages/FormPage'
import { HomePage } from './pages/HomePage'

function App() {
  return (
    <Routes>
      <Route path='/' element={<HomePage />} />
      <Route path='/:uid' element={<FormPage />} />
    </Routes>
  )
}

export default App
