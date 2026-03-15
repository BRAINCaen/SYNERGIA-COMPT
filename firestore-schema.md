# Structure Firestore — SYNERGIA-COMPT

## Collections

### `invoices`
```
{
  id: string (auto-generated)
  user_id: string (Firebase Auth UID)
  file_name: string
  file_path: string (path dans Firebase Storage)
  file_type: string (application/pdf, image/jpeg, etc.)
  supplier_name: string | null
  supplier_siret: string | null
  invoice_number: string | null
  invoice_date: string | null (YYYY-MM-DD)
  due_date: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string (default: "EUR")
  status: "pending" | "processing" | "classified" | "validated" | "exported" | "error"
  raw_extraction: object | null (JSON brut de l'extraction IA)
  error_message: string | null
  created_at: string (ISO 8601)
  updated_at: string (ISO 8601)
}
```

### `invoice_lines`
```
{
  id: string (auto-generated)
  invoice_id: string (ref vers invoices)
  description: string
  quantity: number | null
  unit_price: number | null
  total_ht: number
  tva_rate: number | null
  tva_amount: number | null
  total_ttc: number | null
  pcg_code: string | null
  pcg_label: string | null
  confidence_score: number | null (0-1)
  manually_corrected: boolean (default: false)
  journal_code: string | null (AC, VE, BQ, OD)
}
```

### `suppliers`
```
{
  id: string (auto-generated)
  name: string
  siret: string | null
  default_pcg_code: string | null
  last_used_at: string (ISO 8601)
  created_at: string (ISO 8601)
}
```

### `export_history`
```
{
  id: string (auto-generated)
  user_id: string
  invoice_ids: string[]
  format: "fec" | "csv" | "json"
  created_at: string (ISO 8601)
}
```

## Indexes Firestore nécessaires

Créer ces index composites dans la console Firebase :

1. `invoices` : `status` ASC, `created_at` DESC
2. `invoices` : `user_id` ASC, `created_at` DESC
3. `invoice_lines` : `invoice_id` ASC

## Règles de sécurité Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /invoices/{invoiceId} {
      allow read, write: if request.auth != null;
    }
    match /invoice_lines/{lineId} {
      allow read, write: if request.auth != null;
    }
    match /suppliers/{supplierId} {
      allow read, write: if request.auth != null;
    }
    match /export_history/{exportId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Règles Firebase Storage

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /invoices/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
