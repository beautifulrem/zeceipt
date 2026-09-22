#!/bin/bash
# Recipient-side views of the Zkool batch and the memo-limit probe (captured, not hand-typed).
# Parameters: GRAPHQL (default http://127.0.0.1:9000/graphql). Uses only account ids on the local regtest server; no key material.
G="${GRAPHQL:-http://127.0.0.1:9000/graphql}"
for id in 6 7 8; do
  echo "\$ curl --noproxy '*' -s -X POST $G -H 'Content-Type: application/json' -d '{\"query\":\"{ transactionsByAccount(idAccount: $id, height: 0) { txid height value notes { value pool memo } } }\"}'"
  curl --noproxy '*' -s -X POST $G -H 'Content-Type: application/json' -d "{\"query\":\"{ transactionsByAccount(idAccount: $id, height: 0) { txid height value notes { value pool memo } } }\"}"; echo
done
echo "\$ # memo-limit probe, 512 bytes (already mined as 1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb, height 648): recipient 6's view with memo lengths"
curl --noproxy '*' -s -X POST $G -H 'Content-Type: application/json' -d '{"query":"{ transactionsByAccount(idAccount: 6, height: 0) { txid height value notes { value memo } } }"}' | python3 -c "
import sys,json
for t in json.load(sys.stdin)['data']['transactionsByAccount']: print(json.dumps({'txid':t['txid'],'height':t['height'],'value':t['value'],'memo_len':[len(n['memo'] or '') for n in t['notes']]}))"
ADDR=$(curl --noproxy '*' -s -X POST $G -H 'Content-Type: application/json' -d '{"query":"{ addressByAccount(idAccount: 6) { ua } }"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['addressByAccount']['ua'])")
M513=$(python3 -c "print('M'*513)")
echo "\$ # memo-limit probe, 513 bytes: pay(idAccount: 5, recipients: [{address: <recipient 6 UA>, amount: \"0.001\", memo: \"M\"×513}], srcPools: 8)"
curl --noproxy '*' -s -X POST $G -H 'Content-Type: application/json' -d "{\"query\":\"mutation(\$id: Int!, \$pay: Payment!) { pay(idAccount: \$id, payment: \$pay) }\",\"variables\":{\"id\":5,\"pay\":{\"recipients\":[{\"address\":\"$ADDR\",\"amount\":\"0.001\",\"memo\":\"$M513\"}],\"srcPools\":8}}}"; echo
