# Trade matching benchmark (#117)

Generated 2026-11-05T11:03:27.602Z on PostgreSQL undefined. Album: Panini FIFA World Cup 2026 (994 stickers).
Each collector owns ~65 % of stickers, ~22 % of owned stickers are duplicates, ~90 % opted into trading.
Request: first page of 20 partners, compatibility sort. Median of 7 runs after 2 warm-ups;
latency includes the Node.js work of the respective implementation.

| Collectors | Visible partners | Previous: rows to Node.js | Previous: median ms | Current: rows to Node.js | Current: median ms |
|---:|---:|---:|---:|---:|---:|
| 50 | 46 | 4767 | 33.1 | 2296 | 31.5 |
| 500 | 449 | 46414 | 362.5 | 2453 | 90.0 |
| 2000 | 1778 | 183043 | 1530.0 | 2561 | 158.2 |

## Findings

- **Host:** Docker on an Apple Silicon development machine. These numbers compare the two
  implementations relative to each other. They are not a Raspberry Pi 4 capacity claim.
- **Previous implementation:** sent every exchange-relevant sticker row for every visible
  partner to Node.js (183,043 rows for one 20-partner page at 2,000 collectors). It also built
  all partner × candidate-sticker pairs in SQL and sorted them on disk (`external merge`).
- **Current implementation:** counts per partner without building pairs. Offers come from
  `holdings(sticker_id, quantity)`. Wanted counts are per-revision availability minus the
  partner's existing holdings. Filtering, sorting and `LIMIT/OFFSET` run in PostgreSQL, and
  sticker lines are loaded only for the partners on the requested page. Rows sent to Node.js
  stay roughly constant (about 2,300–2,600 for a 20-partner page).
- **Indexes:** unchanged. An experimental covering index
  `holdings (sticker_id, quantity) INCLUDE (collection_id)` was not chosen by the planner and
  did not improve latency, so it was not added. The remaining sequential scan on `holdings`
  (wanted-already-held branch, about 70 ms at 1.29 M holdings) is the next candidate if
  larger installations need it.

## Current summary query (50 collectors)

```text
Limit  (cost=2058.76..2058.81 rows=20 width=77) (actual time=11.177..11.183 rows=20 loops=1)
  Buffers: shared hit=2106
  CTE owner_collection
    ->  Seq Scan on collections c  (cost=0.00..1.88 rows=1 width=64) (actual time=0.004..0.006 rows=1 loops=1)
          Filter: ((id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid) AND (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid) AND (status = 'active'::text))
          Rows Removed by Filter: 49
          Buffers: shared hit=1
  CTE owner_candidates
    ->  Hash Right Join  (cost=51.29..1057.73 rows=221 width=50) (actual time=0.320..5.057 rows=509 loops=1)
          Hash Cond: ((owner_holding.collection_id = owner_1.id) AND (owner_holding.sticker_id = owner_sticker.sticker_id))
          Filter: ((owner_holding.sticker_id IS NULL) OR (owner_holding.quantity > 1))
          Rows Removed by Filter: 485
          Buffers: shared hit=446
          ->  Seq Scan on holdings owner_holding  (cost=0.00..755.31 rows=32331 width=34) (actual time=0.003..2.135 rows=32331 loops=1)
                Buffers: shared hit=432
          ->  Hash  (cost=36.38..36.38 rows=994 width=62) (actual time=0.300..0.301 rows=994 loops=1)
                Buckets: 1024  Batches: 1  Memory Usage: 102kB
                Buffers: shared hit=14
                ->  Nested Loop  (cost=0.00..36.38 rows=994 width=62) (actual time=0.003..0.152 rows=994 loops=1)
                      Join Filter: (owner_sticker.revision_id = owner_1.revision_id)
                      Buffers: shared hit=14
                      ->  CTE Scan on owner_collection owner_1  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.002 rows=1 loops=1)
                      ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.002..0.058 rows=994 loops=1)
                            Buffers: shared hit=14
  ->  Sort  (cost=999.16..999.22 rows=25 width=77) (actual time=11.176..11.180 rows=20 loops=1)
        Sort Key: (((COALESCE(offers.offered_count, 0) > 0) AND ((COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)) > 0))) DESC, (LEAST(COALESCE(offers.offered_count, 0), (COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)))) DESC, ((COALESCE(offers.offered_count, 0) + (COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)))) DESC, profile.display_name COLLATE "und-x-icu", partner.collector_id
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=2106
        ->  WindowAgg  (cost=997.87..998.58 rows=25 width=77) (actual time=11.135..11.146 rows=46 loops=1)
              Buffers: shared hit=2106
              ->  Nested Loop  (cost=994.41..997.70 rows=25 width=36) (actual time=11.088..11.124 rows=46 loops=1)
                    Join Filter: ((partner.collector_id <> owner.collector_id) AND (owner.album_id = partner.album_id))
                    Buffers: shared hit=2106
                    ->  CTE Scan on owner_collection owner  (cost=0.00..0.02 rows=1 width=32) (actual time=0.006..0.006 rows=1 loops=1)
                          Buffers: shared hit=1
                    ->  Hash Left Join  (cost=994.41..997.29 rows=26 width=52) (actual time=11.081..11.113 rows=46 loops=1)
                          Hash Cond: (partner.id = held.collection_id)
                          Filter: ((COALESCE(offers.offered_count, 0) > 0) OR ((COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)) > 0))
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2105
                          ->  Hash Join  (cost=74.10..76.85 rows=46 width=64) (actual time=7.017..7.046 rows=47 loops=1)
                                Hash Cond: (partner_preference.collector_id = profile.id)
                                Buffers: shared hit=1673
                                ->  Nested Loop Left Join  (cost=71.98..74.59 rows=46 width=72) (actual time=6.996..7.019 rows=47 loops=1)
                                      Join Filter: (revision_wants.revision_id = partner.revision_id)
                                      Buffers: shared hit=1672
                                      ->  Hash Left Join  (cost=37.30..39.20 rows=46 width=84) (actual time=6.819..6.834 rows=47 loops=1)
                                            Hash Cond: (partner.id = offers.collection_id)
                                            Buffers: shared hit=1658
                                            ->  Hash Join  (cost=2.08..3.84 rows=46 width=80) (actual time=0.031..0.041 rows=47 loops=1)
                                                  Hash Cond: (partner.collector_id = partner_preference.collector_id)
                                                  Buffers: shared hit=2
                                                  ->  Seq Scan on collections partner  (cost=0.00..1.62 rows=50 width=64) (actual time=0.001..0.005 rows=50 loops=1)
                                                        Filter: (status = 'active'::text)
                                                        Buffers: shared hit=1
                                                  ->  Hash  (cost=1.50..1.50 rows=46 width=16) (actual time=0.019..0.019 rows=47 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on trading_preferences partner_preference  (cost=0.00..1.50 rows=46 width=16) (actual time=0.003..0.006 rows=47 loops=1)
                                                              Filter: visible
                                                              Rows Removed by Filter: 3
                                                              Buffers: shared hit=1
                                            ->  Hash  (cost=35.14..35.14 rows=7 width=20) (actual time=6.778..6.779 rows=49 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                                  Buffers: shared hit=1656
                                                  ->  Subquery Scan on offers  (cost=34.93..35.14 rows=7 width=20) (actual time=6.548..6.773 rows=49 loops=1)
                                                        Buffers: shared hit=1656
                                                        ->  GroupAggregate  (cost=34.93..35.07 rows=7 width=20) (actual time=6.548..6.768 rows=49 loops=1)
                                                              Group Key: partner_holding.collection_id
                                                              Buffers: shared hit=1656
                                                              ->  Sort  (cost=34.93..34.95 rows=7 width=16) (actual time=6.537..6.616 rows=2603 loops=1)
                                                                    Sort Key: partner_holding.collection_id
                                                                    Sort Method: quicksort  Memory: 97kB
                                                                    Buffers: shared hit=1656
                                                                    ->  Nested Loop  (cost=4.36..34.83 rows=7 width=16) (actual time=5.063..6.250 rows=2603 loops=1)
                                                                          Buffers: shared hit=1656
                                                                          ->  CTE Scan on owner_candidates candidate  (cost=0.00..4.97 rows=1 width=16) (actual time=5.054..5.190 rows=364 loops=1)
                                                                                Filter: (quantity = 0)
                                                                                Rows Removed by Filter: 145
                                                                                Buffers: shared hit=446
                                                                          ->  Bitmap Heap Scan on holdings partner_holding  (cost=4.36..29.79 rows=7 width=32) (actual time=0.002..0.002 rows=7 loops=364)
                                                                                Recheck Cond: ((sticker_id = candidate.sticker_id) AND (quantity > 1))
                                                                                Heap Blocks: exact=482
                                                                                Buffers: shared hit=1210
                                                                                ->  Bitmap Index Scan on holdings_sticker_quantity_idx  (cost=0.00..4.36 rows=7 width=0) (actual time=0.001..0.001 rows=7 loops=364)
                                                                                      Index Cond: ((sticker_id = candidate.sticker_id) AND (quantity > 1))
                                                                                      Buffers: shared hit=728
                                      ->  Materialize  (cost=34.67..34.70 rows=1 width=20) (actual time=0.004..0.004 rows=1 loops=47)
                                            Buffers: shared hit=14
                                            ->  Subquery Scan on revision_wants  (cost=34.67..34.70 rows=1 width=20) (actual time=0.172..0.173 rows=1 loops=1)
                                                  Buffers: shared hit=14
                                                  ->  HashAggregate  (cost=34.67..34.69 rows=1 width=20) (actual time=0.172..0.173 rows=1 loops=1)
                                                        Group Key: partner_sticker.revision_id
                                                        Batches: 1  Memory Usage: 24kB
                                                        Buffers: shared hit=14
                                                        ->  Hash Join  (cost=5.90..34.30 rows=74 width=16) (actual time=0.048..0.157 rows=145 loops=1)
                                                              Hash Cond: (partner_sticker.sticker_id = candidate_1.sticker_id)
                                                              Buffers: shared hit=14
                                                              ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=32) (actual time=0.002..0.040 rows=994 loops=1)
                                                                    Buffers: shared hit=14
                                                              ->  Hash  (cost=4.97..4.97 rows=74 width=16) (actual time=0.041..0.041 rows=145 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 15kB
                                                                    ->  CTE Scan on owner_candidates candidate_1  (cost=0.00..4.97 rows=74 width=16) (actual time=0.000..0.024 rows=145 loops=1)
                                                                          Filter: (quantity > 1)
                                                                          Rows Removed by Filter: 364
                                ->  Hash  (cost=1.50..1.50 rows=50 width=24) (actual time=0.015..0.015 rows=50 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                      Buffers: shared hit=1
                                      ->  Seq Scan on collector_profiles profile  (cost=0.00..1.50 rows=50 width=24) (actual time=0.003..0.006 rows=50 loops=1)
                                            Buffers: shared hit=1
                          ->  Hash  (cost=919.68..919.68 rows=50 width=20) (actual time=4.056..4.057 rows=50 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                Buffers: shared hit=432
                                ->  Subquery Scan on held  (cost=918.55..919.68 rows=50 width=20) (actual time=4.038..4.046 rows=50 loops=1)
                                      Buffers: shared hit=432
                                      ->  HashAggregate  (cost=918.55..919.18 rows=50 width=20) (actual time=4.038..4.042 rows=50 loops=1)
                                            Group Key: partner_holding_1.collection_id
                                            Batches: 1  Memory Usage: 24kB
                                            Buffers: shared hit=432
                                            ->  Hash Join  (cost=5.90..906.52 rows=2407 width=16) (actual time=0.043..3.588 rows=4767 loops=1)
                                                  Hash Cond: (partner_holding_1.sticker_id = candidate_2.sticker_id)
                                                  Buffers: shared hit=432
                                                  ->  Seq Scan on holdings partner_holding_1  (cost=0.00..755.31 rows=32331 width=32) (actual time=0.001..1.415 rows=32331 loops=1)
                                                        Buffers: shared hit=432
                                                  ->  Hash  (cost=4.97..4.97 rows=74 width=16) (actual time=0.036..0.037 rows=145 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 15kB
                                                        ->  CTE Scan on owner_candidates candidate_2  (cost=0.00..4.97 rows=74 width=16) (actual time=0.000..0.024 rows=145 loops=1)
                                                              Filter: (quantity > 1)
                                                              Rows Removed by Filter: 364
Planning:
  Buffers: shared hit=43
Planning Time: 2.383 ms
Execution Time: 11.465 ms
```
## Current detail query for one page (50 collectors)

```text
Sort  (cost=2410.02..2410.03 rows=4 width=87) (actual time=14.727..14.798 rows=2225 loops=1)
  Sort Key: partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id
  Sort Method: quicksort  Memory: 333kB
  Buffers: shared hit=5345
  CTE owner_collection
    ->  Seq Scan on collections c  (cost=0.00..1.88 rows=1 width=64) (actual time=0.003..0.005 rows=1 loops=1)
          Filter: ((id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid) AND (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid) AND (status = 'active'::text))
          Rows Removed by Filter: 49
          Buffers: shared hit=1
  ->  Nested Loop  (cost=1332.35..2408.11 rows=4 width=87) (actual time=5.565..13.086 rows=2225 loops=1)
        Buffers: shared hit=5345
        ->  Nested Loop  (cost=1332.21..2407.41 rows=4 width=71) (actual time=5.556..12.015 rows=2225 loops=1)
              Join Filter: ((partner.collector_id <> owner.collector_id) AND (owner.album_id = partner.album_id))
              Buffers: shared hit=895
              ->  CTE Scan on owner_collection owner  (cost=0.00..0.02 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=1)
                    Buffers: shared hit=1
              ->  Hash Left Join  (cost=1332.21..2407.33 rows=4 width=87) (actual time=5.552..11.816 rows=2225 loops=1)
                    Hash Cond: ((partner.id = partner_holding.collection_id) AND (partner_sticker.sticker_id = partner_holding.sticker_id))
                    Filter: (((COALESCE((owner_holding.quantity)::integer, 0) = 0) AND (partner_holding.quantity > 1)) OR ((COALESCE((owner_holding.quantity)::integer, 0) > 1) AND (partner_holding.sticker_id IS NULL)))
                    Rows Removed by Filter: 7955
                    Buffers: shared hit=894
                    ->  Hash Join  (cost=91.94..1146.16 rows=3979 width=117) (actual time=0.438..5.179 rows=10180 loops=1)
                          Hash Cond: (partner_sticker.revision_id = partner.revision_id)
                          Buffers: shared hit=462
                          ->  Hash Join  (cost=87.66..1096.58 rows=221 width=85) (actual time=0.405..4.441 rows=509 loops=1)
                                Hash Cond: (owner_sticker.sticker_id = partner_sticker.sticker_id)
                                Buffers: shared hit=460
                                ->  Hash Right Join  (cost=51.29..1057.17 rows=221 width=48) (actual time=0.249..4.204 rows=509 loops=1)
                                      Hash Cond: ((owner_holding.collection_id = owner_1.id) AND (owner_holding.sticker_id = owner_sticker.sticker_id))
                                      Filter: ((owner_holding.sticker_id IS NULL) OR (owner_holding.quantity > 1))
                                      Rows Removed by Filter: 485
                                      Buffers: shared hit=446
                                      ->  Seq Scan on holdings owner_holding  (cost=0.00..755.31 rows=32331 width=34) (actual time=0.001..1.359 rows=32331 loops=1)
                                            Buffers: shared hit=432
                                      ->  Hash  (cost=36.38..36.38 rows=994 width=62) (actual time=0.240..0.241 rows=994 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 102kB
                                            Buffers: shared hit=14
                                            ->  Nested Loop  (cost=0.00..36.38 rows=994 width=62) (actual time=0.002..0.125 rows=994 loops=1)
                                                  Join Filter: (owner_sticker.revision_id = owner_1.revision_id)
                                                  Buffers: shared hit=14
                                                  ->  CTE Scan on owner_collection owner_1  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.002 rows=1 loops=1)
                                                  ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.001..0.038 rows=994 loops=1)
                                                        Buffers: shared hit=14
                                ->  Hash  (cost=23.94..23.94 rows=994 width=37) (actual time=0.152..0.152 rows=994 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 76kB
                                      Buffers: shared hit=14
                                      ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=37) (actual time=0.001..0.052 rows=994 loops=1)
                                            Buffers: shared hit=14
                          ->  Hash  (cost=4.05..4.05 rows=18 width=64) (actual time=0.029..0.030 rows=20 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 10kB
                                Buffers: shared hit=2
                                ->  Hash Join  (cost=2.12..4.05 rows=18 width=64) (actual time=0.019..0.025 rows=20 loops=1)
                                      Hash Cond: (partner.collector_id = partner_preference.collector_id)
                                      Buffers: shared hit=2
                                      ->  Seq Scan on collections partner  (cost=0.05..1.93 rows=20 width=64) (actual time=0.002..0.006 rows=20 loops=1)
                                            Filter: ((status = 'active'::text) AND (collector_id = ANY ('{fa3d63d2-1d8a-44b8-9cb9-3076606aba93,2869c884-c954-4d62-b095-bb07d1421a9d,36d884ec-3f1e-4b47-99c3-4288ec48f6e3,116e91b1-c000-46f1-b642-3eefd331f95d,156030dc-9d19-4b88-b70e-775c7d1e974c,d64fc6cf-6ebe-4725-9f38-1365c71405f2,52c1bb01-0af2-4d17-8060-62f92e9a2d35,fd342c76-0ad4-43fc-a77b-4a2c2744ff8f,296accf0-8e2f-4158-8582-637ad0c203a5,3147a71b-d723-4f6f-b8f6-19f0bb8c3317,fe11a676-394a-421d-a8d0-8d8e9a0e4084,9a94ec21-5ff3-4081-99be-b0f3d59a1d28,dc1080eb-664f-404f-844a-e5681170c1c7,4c465513-ccde-420d-9aa1-c24a1ec5a1b0,eda611b9-c8b2-4cce-b516-13a7bc4a4ab6,e1a6e6e0-bd80-483e-9911-f0e346788f26,8dd61594-0796-4816-9029-f2dfee5d58e5,4e12fee2-3f39-4077-bb0e-a2945ca5de65,0df654b2-b0d0-4eb5-8076-050ab1857f17,e05b1260-9371-4656-9082-3ebe46d7540f}'::uuid[])))
                                            Rows Removed by Filter: 30
                                            Buffers: shared hit=1
                                      ->  Hash  (cost=1.50..1.50 rows=46 width=16) (actual time=0.010..0.011 rows=47 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                            Buffers: shared hit=1
                                            ->  Seq Scan on trading_preferences partner_preference  (cost=0.00..1.50 rows=46 width=16) (actual time=0.001..0.004 rows=47 loops=1)
                                                  Filter: visible
                                                  Rows Removed by Filter: 3
                                                  Buffers: shared hit=1
                    ->  Hash  (cost=755.31..755.31 rows=32331 width=34) (actual time=5.060..5.060 rows=32331 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 2340kB
                          Buffers: shared hit=432
                          ->  Seq Scan on holdings partner_holding  (cost=0.00..755.31 rows=32331 width=34) (actual time=0.002..1.868 rows=32331 loops=1)
                                Buffers: shared hit=432
        ->  Index Scan using album_sections_pkey on album_sections section  (cost=0.14..0.17 rows=1 width=28) (actual time=0.000..0.000 rows=1 loops=2225)
              Index Cond: (id = owner_sticker.section_id)
              Buffers: shared hit=4450
Planning:
  Buffers: shared hit=28
Planning Time: 1.086 ms
Execution Time: 15.274 ms
```
## Previous query (50 collectors)

```text
Sort  (cost=3089.53..3089.54 rows=1 width=95) (actual time=26.563..26.756 rows=4767 loops=1)
  Sort Key: profile.display_name, partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id
  Sort Method: quicksort  Memory: 742kB
  Buffers: shared hit=897
  ->  Hash Left Join  (cost=2132.21..3089.52 rows=1 width=95) (actual time=6.543..21.726 rows=4767 loops=1)
        Hash Cond: ((partner.id = partner_holding.collection_id) AND (partner_sticker.sticker_id = partner_holding.sticker_id))
        Filter: (((owner_holding.sticker_id IS NULL) AND (partner_holding.quantity > 1)) OR ((owner_holding.quantity > 1) AND (partner_holding.sticker_id IS NULL)))
        Rows Removed by Filter: 40957
        Buffers: shared hit=897
        ->  Hash Left Join  (cost=891.94..1614.39 rows=44730 width=137) (actual time=1.406..9.725 rows=45724 loops=1)
              Hash Cond: (owner_sticker.sticker_id = owner_holding.sticker_id)
              Buffers: shared hit=465
              ->  Hash Join  (cost=47.83..652.36 rows=44730 width=135) (actual time=0.262..4.056 rows=45724 loops=1)
                    Hash Cond: ((owner_sticker.revision_id = owner.revision_id) AND (partner_sticker.revision_id = partner.revision_id))
                    Buffers: shared hit=33
                    ->  Hash Join  (cost=38.49..78.93 rows=994 width=111) (actual time=0.176..0.614 rows=994 loops=1)
                          Hash Cond: (owner_sticker.section_id = section.id)
                          Buffers: shared hit=29
                          ->  Hash Join  (cost=36.36..73.97 rows=994 width=99) (actual time=0.160..0.477 rows=994 loops=1)
                                Hash Cond: (owner_sticker.sticker_id = partner_sticker.sticker_id)
                                Buffers: shared hit=28
                                ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.002..0.062 rows=994 loops=1)
                                      Buffers: shared hit=14
                                ->  Hash  (cost=23.94..23.94 rows=994 width=37) (actual time=0.152..0.153 rows=994 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 76kB
                                      Buffers: shared hit=14
                                      ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=37) (actual time=0.001..0.060 rows=994 loops=1)
                                            Buffers: shared hit=14
                          ->  Hash  (cost=1.50..1.50 rows=50 width=28) (actual time=0.012..0.012 rows=50 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                Buffers: shared hit=1
                                ->  Seq Scan on album_sections section  (cost=0.00..1.50 rows=50 width=28) (actual time=0.002..0.005 rows=50 loops=1)
                                      Buffers: shared hit=1
                    ->  Hash  (cost=8.66..8.66 rows=45 width=88) (actual time=0.082..0.084 rows=46 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 14kB
                          Buffers: shared hit=4
                          ->  Hash Join  (cost=4.20..8.66 rows=45 width=88) (actual time=0.051..0.071 rows=46 loops=1)
                                Hash Cond: (partner_preference.collector_id = profile.id)
                                Buffers: shared hit=4
                                ->  Nested Loop  (cost=2.08..6.41 rows=45 width=96) (actual time=0.022..0.037 rows=46 loops=1)
                                      Join Filter: ((partner.collector_id <> owner.collector_id) AND (partner.album_id = owner.album_id))
                                      Rows Removed by Join Filter: 1
                                      Buffers: shared hit=3
                                      ->  Seq Scan on collections owner  (cost=0.00..1.88 rows=1 width=64) (actual time=0.002..0.004 rows=1 loops=1)
                                            Filter: ((status = 'active'::text) AND (id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid) AND (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid))
                                            Rows Removed by Filter: 49
                                            Buffers: shared hit=1
                                      ->  Hash Join  (cost=2.08..3.84 rows=46 width=80) (actual time=0.019..0.028 rows=47 loops=1)
                                            Hash Cond: (partner.collector_id = partner_preference.collector_id)
                                            Buffers: shared hit=2
                                            ->  Seq Scan on collections partner  (cost=0.00..1.62 rows=50 width=64) (actual time=0.001..0.004 rows=50 loops=1)
                                                  Filter: (status = 'active'::text)
                                                  Buffers: shared hit=1
                                            ->  Hash  (cost=1.50..1.50 rows=46 width=16) (actual time=0.014..0.014 rows=47 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on trading_preferences partner_preference  (cost=0.00..1.50 rows=46 width=16) (actual time=0.006..0.008 rows=47 loops=1)
                                                        Filter: visible
                                                        Rows Removed by Filter: 3
                                                        Buffers: shared hit=1
                                ->  Hash  (cost=1.50..1.50 rows=50 width=24) (actual time=0.018..0.018 rows=50 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                      Buffers: shared hit=1
                                      ->  Seq Scan on collector_profiles profile  (cost=0.00..1.50 rows=50 width=24) (actual time=0.005..0.008 rows=50 loops=1)
                                            Buffers: shared hit=1
              ->  Hash  (cost=836.14..836.14 rows=638 width=34) (actual time=1.137..1.137 rows=630 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 49kB
                    Buffers: shared hit=432
                    ->  Seq Scan on holdings owner_holding  (cost=0.00..836.14 rows=638 width=34) (actual time=0.004..1.072 rows=630 loops=1)
                          Filter: (collection_id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
                          Rows Removed by Filter: 31701
                          Buffers: shared hit=432
        ->  Hash  (cost=755.31..755.31 rows=32331 width=34) (actual time=5.059..5.060 rows=32331 loops=1)
              Buckets: 32768  Batches: 1  Memory Usage: 2340kB
              Buffers: shared hit=432
              ->  Seq Scan on holdings partner_holding  (cost=0.00..755.31 rows=32331 width=34) (actual time=0.002..1.808 rows=32331 loops=1)
                    Buffers: shared hit=432
Planning:
  Buffers: shared hit=45
Planning Time: 2.366 ms
Execution Time: 27.588 ms
```
## Current summary query (2000 collectors)

```text
Limit  (cost=46373.10..46373.15 rows=20 width=79) (actual time=239.777..239.788 rows=20 loops=1)
  Buffers: shared hit=101220 read=1728
  CTE owner_collection
    ->  Index Scan using collections_one_active_album on collections c  (cost=0.28..8.30 rows=1 width=64) (actual time=0.006..0.007 rows=1 loops=1)
          Index Cond: (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid)
          Filter: (id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
          Buffers: shared hit=3
  CTE owner_candidates
    ->  Nested Loop Left Join  (cost=0.43..8446.17 rows=220 width=50) (actual time=0.011..1.622 rows=509 loops=1)
          Filter: ((owner_holding.sticker_id IS NULL) OR (owner_holding.quantity > 1))
          Rows Removed by Filter: 485
          Buffers: shared hit=3626
          ->  Nested Loop  (cost=0.00..36.38 rows=994 width=62) (actual time=0.002..0.225 rows=994 loops=1)
                Join Filter: (owner_sticker.revision_id = owner_1.revision_id)
                Buffers: shared hit=14
                ->  CTE Scan on owner_collection owner_1  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.001 rows=1 loops=1)
                ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.001..0.064 rows=994 loops=1)
                      Buffers: shared hit=14
          ->  Index Scan using holdings_pkey on holdings owner_holding  (cost=0.43..8.45 rows=1 width=34) (actual time=0.001..0.001 rows=1 loops=994)
                Index Cond: ((collection_id = owner_1.id) AND (sticker_id = owner_sticker.sticker_id))
                Buffers: shared hit=3612
  ->  Sort  (cost=37918.63..37921.10 rows=988 width=79) (actual time=239.776..239.784 rows=20 loops=1)
        Sort Key: (((COALESCE(offers.offered_count, 0) > 0) AND ((COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)) > 0))) DESC, (LEAST(COALESCE(offers.offered_count, 0), (COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)))) DESC, ((COALESCE(offers.offered_count, 0) + (COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)))) DESC, profile.display_name COLLATE "und-x-icu", partner.collector_id
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=101220 read=1728
        ->  WindowAgg  (cost=37869.98..37892.34 rows=988 width=79) (actual time=239.241..239.479 rows=1778 loops=1)
              Buffers: shared hit=101220 read=1728
              ->  Nested Loop  (cost=37742.90..37857.76 rows=988 width=38) (actual time=237.570..239.031 rows=1778 loops=1)
                    Join Filter: ((partner.collector_id <> owner.collector_id) AND (owner.album_id = partner.album_id))
                    Buffers: shared hit=101220 read=1728
                    ->  CTE Scan on owner_collection owner  (cost=0.00..0.02 rows=1 width=32) (actual time=0.007..0.008 rows=1 loops=1)
                          Buffers: shared hit=3
                    ->  Hash Left Join  (cost=37742.90..37842.92 rows=988 width=54) (actual time=237.561..238.868 rows=1778 loops=1)
                          Hash Cond: (partner.id = held.collection_id)
                          Filter: ((COALESCE(offers.offered_count, 0) > 0) OR ((COALESCE(revision_wants.available_count, 0) - COALESCE(held.held_count, 0)) > 0))
                          Rows Removed by Filter: 1
                          Buffers: shared hit=101217 read=1728
                          ->  Hash Join  (cost=1237.38..1332.72 rows=1779 width=66) (actual time=63.908..65.004 rows=1779 loops=1)
                                Hash Cond: (partner_preference.collector_id = profile.id)
                                Buffers: shared hit=85711
                                ->  Nested Loop Left Join  (cost=1171.38..1262.03 rows=1779 width=72) (actual time=63.586..64.455 rows=1779 loops=1)
                                      Join Filter: (revision_wants.revision_id = partner.revision_id)
                                      Buffers: shared hit=85690
                                      ->  Hash Left Join  (cost=1136.76..1200.70 rows=1779 width=84) (actual time=63.386..64.003 rows=1779 loops=1)
                                            Hash Cond: (partner.id = offers.collection_id)
                                            Buffers: shared hit=85676
                                            ->  Hash Join  (cost=72.24..131.50 rows=1779 width=80) (actual time=0.283..0.668 rows=1779 loops=1)
                                                  Hash Cond: (partner.collector_id = partner_preference.collector_id)
                                                  Buffers: shared hit=59
                                                  ->  Seq Scan on collections partner  (cost=0.00..54.00 rows=2000 width=64) (actual time=0.002..0.165 rows=2000 loops=1)
                                                        Filter: (status = 'active'::text)
                                                        Buffers: shared hit=29
                                                  ->  Hash  (cost=50.00..50.00 rows=1779 width=16) (actual time=0.274..0.274 rows=1779 loops=1)
                                                        Buckets: 2048  Batches: 1  Memory Usage: 100kB
                                                        Buffers: shared hit=30
                                                        ->  Seq Scan on trading_preferences partner_preference  (cost=0.00..50.00 rows=1779 width=16) (actual time=0.005..0.139 rows=1779 loops=1)
                                                              Filter: visible
                                                              Rows Removed by Filter: 221
                                                              Buffers: shared hit=30
                                            ->  Hash  (cost=1060.92..1060.92 rows=288 width=20) (actual time=63.096..63.098 rows=1999 loops=1)
                                                  Buckets: 2048 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 118kB
                                                  Buffers: shared hit=85617
                                                  ->  Subquery Scan on offers  (cost=1054.44..1060.92 rows=288 width=20) (actual time=62.604..62.878 rows=1999 loops=1)
                                                        Buffers: shared hit=85617
                                                        ->  HashAggregate  (cost=1054.44..1058.04 rows=288 width=20) (actual time=62.604..62.759 rows=1999 loops=1)
                                                              Group Key: partner_holding.collection_id
                                                              Batches: 1  Memory Usage: 241kB
                                                              Buffers: shared hit=85617
                                                              ->  Nested Loop  (cost=7.38..1053.00 rows=288 width=16) (actual time=0.060..51.138 rows=104654 loops=1)
                                                                    Buffers: shared hit=85617
                                                                    ->  CTE Scan on owner_candidates candidate  (cost=0.00..4.95 rows=1 width=16) (actual time=0.018..1.793 rows=364 loops=1)
                                                                          Filter: (quantity = 0)
                                                                          Rows Removed by Filter: 145
                                                                          Buffers: shared hit=3626
                                                                    ->  Bitmap Heap Scan on holdings partner_holding  (cost=7.38..1045.17 rows=288 width=32) (actual time=0.022..0.117 rows=288 loops=364)
                                                                          Recheck Cond: ((sticker_id = candidate.sticker_id) AND (quantity > 1))
                                                                          Heap Blocks: exact=80666
                                                                          Buffers: shared hit=81991
                                                                          ->  Bitmap Index Scan on holdings_sticker_quantity_idx  (cost=0.00..7.31 rows=288 width=0) (actual time=0.010..0.010 rows=288 loops=364)
                                                                                Index Cond: ((sticker_id = candidate.sticker_id) AND (quantity > 1))
                                                                                Buffers: shared hit=1325
                                      ->  Materialize  (cost=34.62..34.65 rows=1 width=20) (actual time=0.000..0.000 rows=1 loops=1779)
                                            Buffers: shared hit=14
                                            ->  Subquery Scan on revision_wants  (cost=34.62..34.65 rows=1 width=20) (actual time=0.197..0.198 rows=1 loops=1)
                                                  Buffers: shared hit=14
                                                  ->  HashAggregate  (cost=34.62..34.64 rows=1 width=20) (actual time=0.197..0.198 rows=1 loops=1)
                                                        Group Key: partner_sticker.revision_id
                                                        Batches: 1  Memory Usage: 24kB
                                                        Buffers: shared hit=14
                                                        ->  Hash Join  (cost=5.86..34.26 rows=73 width=16) (actual time=0.069..0.184 rows=145 loops=1)
                                                              Hash Cond: (partner_sticker.sticker_id = candidate_1.sticker_id)
                                                              Buffers: shared hit=14
                                                              ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=32) (actual time=0.005..0.050 rows=994 loops=1)
                                                                    Buffers: shared hit=14
                                                              ->  Hash  (cost=4.95..4.95 rows=73 width=16) (actual time=0.046..0.046 rows=145 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 15kB
                                                                    ->  CTE Scan on owner_candidates candidate_1  (cost=0.00..4.95 rows=73 width=16) (actual time=0.001..0.030 rows=145 loops=1)
                                                                          Filter: (quantity > 1)
                                                                          Rows Removed by Filter: 364
                                ->  Hash  (cost=41.00..41.00 rows=2000 width=26) (actual time=0.312..0.313 rows=2000 loops=1)
                                      Buckets: 2048  Batches: 1  Memory Usage: 131kB
                                      Buffers: shared hit=21
                                      ->  Seq Scan on collector_profiles profile  (cost=0.00..41.00 rows=2000 width=26) (actual time=0.004..0.126 rows=2000 loops=1)
                                            Buffers: shared hit=21
                          ->  Hash  (cost=36480.51..36480.51 rows=2000 width=20) (actual time=173.636..173.638 rows=2000 loops=1)
                                Buckets: 2048  Batches: 1  Memory Usage: 118kB
                                Buffers: shared hit=15506 read=1728
                                ->  Subquery Scan on held  (cost=36435.51..36480.51 rows=2000 width=20) (actual time=173.151..173.423 rows=2000 loops=1)
                                      Buffers: shared hit=15506 read=1728
                                      ->  HashAggregate  (cost=36435.51..36460.51 rows=2000 width=20) (actual time=173.150..173.306 rows=2000 loops=1)
                                            Group Key: partner_holding_1.collection_id
                                            Batches: 1  Memory Usage: 241kB
                                            Buffers: shared hit=15506 read=1728
                                            ->  Hash Join  (cost=5.86..35960.90 rows=94922 width=16) (actual time=0.047..156.754 rows=188814 loops=1)
                                                  Hash Cond: (partner_holding_1.sticker_id = candidate_2.sticker_id)
                                                  Buffers: shared hit=15506 read=1728
                                                  ->  Seq Scan on holdings partner_holding_1  (cost=0.00..30158.96 rows=1292496 width=32) (actual time=0.002..67.691 rows=1292496 loops=1)
                                                        Buffers: shared hit=15506 read=1728
                                                  ->  Hash  (cost=4.95..4.95 rows=73 width=16) (actual time=0.040..0.040 rows=145 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 15kB
                                                        ->  CTE Scan on owner_candidates candidate_2  (cost=0.00..4.95 rows=73 width=16) (actual time=0.000..0.026 rows=145 loops=1)
                                                              Filter: (quantity > 1)
                                                              Rows Removed by Filter: 364
Planning:
  Buffers: shared hit=79
Planning Time: 2.028 ms
Execution Time: 240.138 ms
```
## Current detail query for one page (2000 collectors)

```text
Incremental Sort  (cost=10622.23..42350.41 rows=4 width=87) (actual time=2.532..15.564 rows=2490 loops=1)
  Sort Key: partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id
  Presorted Key: partner.collector_id
  Full-sort Groups: 20  Sort Method: quicksort  Average Memory: 32kB  Peak Memory: 32kB
  Pre-sorted Groups: 20  Sort Method: quicksort  Average Memory: 38kB  Peak Memory: 38kB
  Buffers: shared hit=45733
  CTE owner_collection
    ->  Index Scan using collections_one_active_album on collections c  (cost=0.28..8.30 rows=1 width=64) (actual time=0.006..0.006 rows=1 loops=1)
          Index Cond: (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid)
          Filter: (id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
          Buffers: shared hit=3
  ->  Nested Loop  (cost=37.91..42341.94 rows=4 width=87) (actual time=0.212..14.933 rows=2490 loops=1)
        Buffers: shared hit=45733
        ->  Nested Loop  (cost=37.77..42341.24 rows=4 width=71) (actual time=0.207..13.672 rows=2490 loops=1)
              Join Filter: ((partner.collector_id <> owner.collector_id) AND (owner.album_id = partner.album_id))
              Buffers: shared hit=40753
              ->  Nested Loop Left Join  (cost=37.77..42341.13 rows=4 width=87) (actual time=0.206..13.050 rows=2490 loops=1)
                    Filter: (((COALESCE((owner_holding.quantity)::integer, 0) = 0) AND (partner_holding.quantity > 1)) OR ((COALESCE((owner_holding.quantity)::integer, 0) > 1) AND (partner_holding.sticker_id IS NULL)))
                    Rows Removed by Filter: 7690
                    Buffers: shared hit=40753
                    ->  Nested Loop  (cost=37.35..8766.05 rows=3964 width=117) (actual time=0.195..3.179 rows=10180 loops=1)
                          Join Filter: (partner_sticker.revision_id = partner.revision_id)
                          Buffers: shared hit=3741
                          ->  Nested Loop  (cost=0.56..221.08 rows=18 width=64) (actual time=0.021..0.074 rows=20 loops=1)
                                Buffers: shared hit=98
                                ->  Index Scan using collections_collector_idx on collections partner  (cost=0.28..99.17 rows=20 width=64) (actual time=0.010..0.032 rows=20 loops=1)
                                      Index Cond: (collector_id = ANY ('{0dc56c72-0841-4995-95f8-2687935afdcd,e8ad337e-0606-4275-a078-7a62d96fb1d9,c5f1b79a-227e-4fce-9d8e-d11a1d5ff1cd,fa3d63d2-1d8a-44b8-9cb9-3076606aba93,4257ff58-0589-450f-8c06-b971d1f3a0b4,06131631-24ee-4d29-b56f-e71b211d55cf,e0a1e970-779b-447a-88b3-45781807576b,09f18799-9b1b-4cb3-8e10-4d752fa0f29b,55505f32-bea3-4cdd-8ba4-150fd3504f04,fdb2636c-0b5d-42ac-b63e-b557a26b4b59,e3e7f954-8a02-4156-8700-4162123982f0,292364a4-55ae-419a-b26b-50e16256cad0,4a424694-9220-41ed-97e1-9832d3979141,4b05a08f-9e38-4556-958c-22b50b087c58,4ccbec9d-af14-4e9b-9dc8-a29282ff7cdb,831f55a9-723a-47f2-94e3-710224075c57,24a77967-eeba-4ca1-ba25-5c11feeed1a5,4a446b8a-908d-4706-8c4e-7f9c3e2fd420,2d24fda7-34ef-47d2-9699-716b9701dc1f,d825f50f-79b4-4ca6-8ae6-793b64a2a72c}'::uuid[]))
                                      Filter: (status = 'active'::text)
                                      Buffers: shared hit=37
                                ->  Index Only Scan using trading_preferences_visible_idx on trading_preferences partner_preference  (cost=0.28..6.09 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=20)
                                      Index Cond: (collector_id = partner.collector_id)
                                      Heap Fetches: 20
                                      Buffers: shared hit=61
                          ->  Materialize  (cost=36.79..8486.11 rows=220 width=85) (actual time=0.009..0.097 rows=509 loops=20)
                                Buffers: shared hit=3643
                                ->  Hash Join  (cost=36.79..8485.01 rows=220 width=85) (actual time=0.172..1.501 rows=509 loops=1)
                                      Hash Cond: (owner_sticker.sticker_id = partner_sticker.sticker_id)
                                      Buffers: shared hit=3643
                                      ->  Nested Loop Left Join  (cost=0.43..8445.62 rows=220 width=48) (actual time=0.021..1.271 rows=509 loops=1)
                                            Filter: ((owner_holding.sticker_id IS NULL) OR (owner_holding.quantity > 1))
                                            Rows Removed by Filter: 485
                                            Buffers: shared hit=3629
                                            ->  Nested Loop  (cost=0.00..36.38 rows=994 width=62) (actual time=0.011..0.146 rows=994 loops=1)
                                                  Join Filter: (owner_sticker.revision_id = owner_1.revision_id)
                                                  Buffers: shared hit=17
                                                  ->  CTE Scan on owner_collection owner_1  (cost=0.00..0.02 rows=1 width=32) (actual time=0.007..0.007 rows=1 loops=1)
                                                        Buffers: shared hit=3
                                                  ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.003..0.045 rows=994 loops=1)
                                                        Buffers: shared hit=14
                                            ->  Index Scan using holdings_pkey on holdings owner_holding  (cost=0.43..8.45 rows=1 width=34) (actual time=0.001..0.001 rows=1 loops=994)
                                                  Index Cond: ((collection_id = owner_1.id) AND (sticker_id = owner_sticker.sticker_id))
                                                  Buffers: shared hit=3612
                                      ->  Hash  (cost=23.94..23.94 rows=994 width=37) (actual time=0.145..0.146 rows=994 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 76kB
                                            Buffers: shared hit=14
                                            ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=37) (actual time=0.001..0.058 rows=994 loops=1)
                                                  Buffers: shared hit=14
                    ->  Index Scan using holdings_pkey on holdings partner_holding  (cost=0.43..8.45 rows=1 width=34) (actual time=0.001..0.001 rows=1 loops=10180)
                          Index Cond: ((collection_id = partner.id) AND (sticker_id = partner_sticker.sticker_id))
                          Buffers: shared hit=37012
              ->  CTE Scan on owner_collection owner  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.000 rows=1 loops=2490)
        ->  Index Scan using album_sections_pkey on album_sections section  (cost=0.14..0.17 rows=1 width=28) (actual time=0.000..0.000 rows=1 loops=2490)
              Index Cond: (id = owner_sticker.section_id)
              Buffers: shared hit=4980
Planning:
  Buffers: shared hit=61
Planning Time: 1.261 ms
Execution Time: 15.844 ms
```
## Previous query (2000 collectors)

```text
Sort  (cost=180616.11..180616.11 rows=1 width=97) (actual time=1413.427..1478.823 rows=183043 loops=1)
  Sort Key: profile.display_name, partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id
  Sort Method: external merge  Disk: 20024kB
  Buffers: shared hit=16000 read=1747, temp read=42964 written=42970
  ->  Hash Left Join  (cost=60018.26..180616.10 rows=1 width=97) (actual time=240.165..1246.329 rows=183043 loops=1)
        Hash Cond: ((partner.id = partner_holding.collection_id) AND (partner_sticker.sticker_id = partner_holding.sticker_id))
        Filter: (((owner_holding.sticker_id IS NULL) AND (partner_holding.quantity > 1)) OR ((owner_holding.quantity > 1) AND (partner_holding.sticker_id IS NULL)))
        Rows Removed by Filter: 1584289
        Buffers: shared hit=16000 read=1747, temp read=40461 written=40461
        ->  Hash Join  (cost=373.86..29105.18 rows=1767332 width=139) (actual time=22.252..175.980 rows=1767332 loops=1)
              Hash Cond: ((owner.album_id = partner.album_id) AND (partner_sticker.revision_id = partner.revision_id))
              Join Filter: (partner.collector_id <> owner.collector_id)
              Rows Removed by Join Filter: 994
              Buffers: shared hit=512 read=1
              ->  Hash Join  (cost=145.00..2346.46 rows=994 width=145) (actual time=20.641..22.269 rows=994 loops=1)
                    Hash Cond: (owner_sticker.section_id = section.id)
                    Buffers: shared hit=432 read=1
                    ->  Hash Join  (cost=142.87..2341.50 rows=994 width=133) (actual time=0.918..2.354 rows=994 loops=1)
                          Hash Cond: (owner_sticker.sticker_id = partner_sticker.sticker_id)
                          Buffers: shared hit=431 read=1
                          ->  Hash Right Join  (cost=106.51..2291.47 rows=994 width=96) (actual time=0.745..1.787 rows=994 loops=1)
                                Hash Cond: (owner_holding.sticker_id = owner_sticker.sticker_id)
                                Buffers: shared hit=417 read=1
                                ->  Bitmap Heap Scan on holdings owner_holding  (cost=49.42..2225.53 rows=644 width=34) (actual time=0.067..0.692 rows=630 loops=1)
                                      Recheck Cond: (collection_id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
                                      Heap Blocks: exact=393
                                      Buffers: shared hit=401
                                      ->  Bitmap Index Scan on holdings_pkey  (cost=0.00..49.26 rows=644 width=0) (actual time=0.042..0.042 rows=630 loops=1)
                                            Index Cond: (collection_id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
                                            Buffers: shared hit=8
                                ->  Hash  (cost=44.66..44.66 rows=994 width=94) (actual time=0.665..0.667 rows=994 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 133kB
                                      Buffers: shared hit=16 read=1
                                      ->  Nested Loop  (cost=0.28..44.66 rows=994 width=94) (actual time=0.295..0.449 rows=994 loops=1)
                                            Join Filter: (owner_sticker.revision_id = owner.revision_id)
                                            Buffers: shared hit=16 read=1
                                            ->  Index Scan using collections_id_album_id_revision_id_key on collections owner  (cost=0.28..8.30 rows=1 width=64) (actual time=0.279..0.280 rows=1 loops=1)
                                                  Index Cond: (id = '5c78ac7a-c3ec-4912-967f-04272fca0db2'::uuid)
                                                  Filter: ((status = 'active'::text) AND (collector_id = '5992cbde-4538-418b-a5e8-6e3c13ebc72d'::uuid))
                                                  Buffers: shared hit=2 read=1
                                            ->  Seq Scan on album_revision_stickers owner_sticker  (cost=0.00..23.94 rows=994 width=62) (actual time=0.011..0.062 rows=994 loops=1)
                                                  Buffers: shared hit=14
                          ->  Hash  (cost=23.94..23.94 rows=994 width=37) (actual time=0.166..0.166 rows=994 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 76kB
                                Buffers: shared hit=14
                                ->  Seq Scan on album_revision_stickers partner_sticker  (cost=0.00..23.94 rows=994 width=37) (actual time=0.005..0.068 rows=994 loops=1)
                                      Buffers: shared hit=14
                    ->  Hash  (cost=1.50..1.50 rows=50 width=28) (actual time=19.716..19.717 rows=50 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 11kB
                          Buffers: shared hit=1
                          ->  Seq Scan on album_sections section  (cost=0.00..1.50 rows=50 width=28) (actual time=19.697..19.703 rows=50 loops=1)
                                Buffers: shared hit=1
              ->  Hash  (cost=202.18..202.18 rows=1779 width=74) (actual time=1.596..1.598 rows=1779 loops=1)
                    Buckets: 2048  Batches: 1  Memory Usage: 201kB
                    Buffers: shared hit=80
                    ->  Hash Join  (cost=138.24..202.18 rows=1779 width=74) (actual time=0.690..1.294 rows=1779 loops=1)
                          Hash Cond: (partner_preference.collector_id = profile.id)
                          Buffers: shared hit=80
                          ->  Hash Join  (cost=72.24..131.50 rows=1779 width=80) (actual time=0.324..0.727 rows=1779 loops=1)
                                Hash Cond: (partner.collector_id = partner_preference.collector_id)
                                Buffers: shared hit=59
                                ->  Seq Scan on collections partner  (cost=0.00..54.00 rows=2000 width=64) (actual time=0.005..0.193 rows=2000 loops=1)
                                      Filter: (status = 'active'::text)
                                      Buffers: shared hit=29
                                ->  Hash  (cost=50.00..50.00 rows=1779 width=16) (actual time=0.308..0.308 rows=1779 loops=1)
                                      Buckets: 2048  Batches: 1  Memory Usage: 100kB
                                      Buffers: shared hit=30
                                      ->  Seq Scan on trading_preferences partner_preference  (cost=0.00..50.00 rows=1779 width=16) (actual time=0.006..0.137 rows=1779 loops=1)
                                            Filter: visible
                                            Rows Removed by Filter: 221
                                            Buffers: shared hit=30
                          ->  Hash  (cost=41.00..41.00 rows=2000 width=26) (actual time=0.357..0.357 rows=2000 loops=1)
                                Buckets: 2048  Batches: 1  Memory Usage: 131kB
                                Buffers: shared hit=21
                                ->  Seq Scan on collector_profiles profile  (cost=0.00..41.00 rows=2000 width=26) (actual time=0.009..0.123 rows=2000 loops=1)
                                      Buffers: shared hit=21
        ->  Hash  (cost=30158.96..30158.96 rows=1292496 width=34) (actual time=217.370..217.370 rows=1292496 loops=1)
              Buckets: 131072  Batches: 16  Memory Usage: 6202kB
              Buffers: shared hit=15488 read=1746, temp written=7983
              ->  Seq Scan on holdings partner_holding  (cost=0.00..30158.96 rows=1292496 width=34) (actual time=0.004..84.608 rows=1292496 loops=1)
                    Buffers: shared hit=15488 read=1746
Planning:
  Buffers: shared hit=80
Planning Time: 2.106 ms
JIT:
  Functions: 82
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 2.109 ms (Deform 0.935 ms), Inlining 0.000 ms, Optimization 0.633 ms, Emission 19.145 ms, Total 21.886 ms
Execution Time: 1495.785 ms
```
