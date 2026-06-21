ALTER TABLE public.photos
DROP CONSTRAINT IF EXISTS photos_time_of_day_check;

ALTER TABLE public.photos
ADD CONSTRAINT photos_time_of_day_check
CHECK (
  time_of_day IS NULL
  OR time_of_day = ANY (
    ARRAY[
      'golden_hour',
      'blue_hour',
      'night',
      'midday',
      'overcast',
      'dawn',
      'dusk',
      'ambiguous'
    ]
  )
);
