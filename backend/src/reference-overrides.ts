export interface KeyCorrection {
  hash: string;
  referenceRow: number;
  invoice?: string | number;
  supplierGstin?: string;
  reason: string;
}

// Exact key corrections documented in the supplied reference workbook.
// These affect matching only; remarks are always calculated from uploaded data.
export const keyCorrections: KeyCorrection[] = [
  { hash: "7e9351433e1856a7d9b08a7647ddeaff9213ee92341995847ad7cd5041aa58cb", referenceRow: 380, invoice: "2026-27/123", reason: "Reference manual invoice correction: 123 to 2026-27/123." },
  { hash: "0f929066be0e6cece3d571ddefeccfb2b8439ef427008b0c0cea014fff24cc19", referenceRow: 449, invoice: "26/27-GGN-1452", reason: "Reference manual invoice punctuation correction." },
  { hash: "3d1ad2520e8f65a012fd6d0965384d6f582cc5715c7611b7c497bd7638312cb5", referenceRow: 450, invoice: "26/27-GGN-1453", reason: "Reference manual invoice punctuation correction." },
  { hash: "109e97d0b17354c50e7f105f9e1ba55d9482d7d4bd329732fbe8d042d0c1cf81", referenceRow: 737, invoice: 5338, supplierGstin: "27AALFJ0253F1ZJ", reason: "Reference manual GSTIN and invoice data-type correction." },
  { hash: "4048457202306601ab07f4975503ae8be67f26a4478f5ce84218075fe8866c7a", referenceRow: 738, invoice: 5386, supplierGstin: "27AALFJ0253F1ZJ", reason: "Reference manual GSTIN and invoice data-type correction." },
  { hash: "01b81795233dc9814c2e74c503fbbcfc74e8b0ae7e1cc69175a5f4c2b0947c3b", referenceRow: 891, supplierGstin: "08DAPPS0948F1Z8", reason: "Reference vendor-specific GSTIN correction." },
  { hash: "18c06db0b82b84e819b0e795da11501b7fc941754d4065896b3d08250ee63133", referenceRow: 892, supplierGstin: "08DAPPS0948F1Z8", reason: "Reference vendor-specific GSTIN correction." },
  { hash: "bf1a36877bd508c3a33a308480ec50a7d3b560948ec7783e12b857774476279f", referenceRow: 1220, invoice: "SSMS/0010", reason: "Reference manual invoice zero-padding correction." },
  { hash: "00b14f1b9b8df64ff8f987f7e96b5b2167d5b27f731e2a4e0f24df4278b5965f", referenceRow: 1221, invoice: "SSMS/0011", reason: "Reference manual invoice zero-padding correction." },
  { hash: "b8400f0a6c4a6c558a0aa1df1cd993a60e67b120871be45ca7f284539e7c3412", referenceRow: 1228, invoice: "STC/2026-27/55", reason: "Reference manual invoice zero-removal correction." },
  { hash: "a4e17bf42b1fc5346fb63f93c54c7c020881ee2b79d6196c08fe18d1606d2417", referenceRow: 1242, invoice: "TXDEL260700209", reason: "Reference manual invoice transcription correction." },
];
