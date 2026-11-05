alter table conversations drop constraint conversations_category_check;
alter table conversations add constraint conversations_category_check
  check (category in ('shipping', 'exchange', 'return', 'size', 'defect', 'restock', 'etc'));
