BEGIN;

UPDATE public.photos
SET order_position = order_position + 1000
WHERE cloudinary_public_id IN (
  'IMG_3839_ctidr7',
  'IMG_4322_bqvubv',
  'DSC_8854-Edit_vic4eo',
  'IMG_0411-Edit_zq8eyp',
  'IMG_0189_h3a3j6',
  'IMG_2734_cui1bb',
  '11709909_1591891641071717_67768479753802604_o_tdmstr',
  'IMG_8302_scue2h',
  'DSC_4594-Edit-Edit_irrhgm',
  'IMG_0672_dx78j8',
  '71_w9dc9x',
  'IMG_3139_z0sozm',
  '_DSC8478-Edit_cbtx46',
  'IMG_0473_hoggsb',
  'IMG_3857_fi2sws'
);

UPDATE public.photos
SET order_position = CASE cloudinary_public_id
  WHEN 'IMG_3839_ctidr7' THEN 0
  WHEN 'IMG_4322_bqvubv' THEN 1
  WHEN 'DSC_8854-Edit_vic4eo' THEN 2
  WHEN 'IMG_0411-Edit_zq8eyp' THEN 3
  WHEN 'IMG_0189_h3a3j6' THEN 4
  WHEN 'IMG_2734_cui1bb' THEN 5
  WHEN '11709909_1591891641071717_67768479753802604_o_tdmstr' THEN 6
  WHEN 'IMG_8302_scue2h' THEN 7
  WHEN 'DSC_4594-Edit-Edit_irrhgm' THEN 8
  WHEN 'IMG_0672_dx78j8' THEN 9
  WHEN '71_w9dc9x' THEN 10
  WHEN 'IMG_3139_z0sozm' THEN 11
  WHEN '_DSC8478-Edit_cbtx46' THEN 12
  WHEN 'IMG_0473_hoggsb' THEN 13
  WHEN 'IMG_3857_fi2sws' THEN 14
END
WHERE cloudinary_public_id IN (
  'IMG_3839_ctidr7',
  'IMG_4322_bqvubv',
  'DSC_8854-Edit_vic4eo',
  'IMG_0411-Edit_zq8eyp',
  'IMG_0189_h3a3j6',
  'IMG_2734_cui1bb',
  '11709909_1591891641071717_67768479753802604_o_tdmstr',
  'IMG_8302_scue2h',
  'DSC_4594-Edit-Edit_irrhgm',
  'IMG_0672_dx78j8',
  '71_w9dc9x',
  'IMG_3139_z0sozm',
  '_DSC8478-Edit_cbtx46',
  'IMG_0473_hoggsb',
  'IMG_3857_fi2sws'
);

COMMIT;
