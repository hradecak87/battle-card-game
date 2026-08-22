begin;

do $$
begin
  assert (select count(*) from card_templates where category = 'boost') = 25,
    'expected 25 boost card templates after this migration (11 existing + 14 new)';

  assert (select count(*) from card_templates where category = 'boost' and rank = 'common') = 5,
    'expected 5 common boost templates';
  assert (select count(*) from card_templates where category = 'boost' and rank = 'uncommon') = 5,
    'expected 5 uncommon boost templates';
  assert (select count(*) from card_templates where category = 'boost' and rank = 'rare') = 5,
    'expected 5 rare boost templates';
  assert (select count(*) from card_templates where category = 'boost' and rank = 'epic') = 5,
    'expected 5 epic boost templates';
  assert (select count(*) from card_templates where category = 'boost' and rank = 'legend') = 5,
    'expected 5 legend boost templates';

  assert exists (
    select 1 from card_templates
    where id = 'boost-offensive-legend-02' and boost_type = 'offensive' and pct_str = 20 and pct_lng = 16 and pct_hp = 12
  ), 'boost-offensive-legend-02 template mismatch';
end;
$$;

rollback;
