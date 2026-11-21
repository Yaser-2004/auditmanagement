import type {Metadata} from 'next';import './globals.css';
export const metadata:Metadata={title:'Learningshala | Audit & Adoption',description:'Audit management, adoption tracking and performance analytics.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
