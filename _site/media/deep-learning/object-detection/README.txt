Road scenes for the object detection and segmentation notes
============================================================

Four Drive.ai photographs, 1280 x 720, unmodified originals.

  0020.jpg   one car in profile, a building behind it and road beneath it
  0055.jpg   one car close to the camera, plus a truck on the right
  0060.jpg   a stretch of road with no vehicle, pedestrian or motorcycle
  test.jpg   a busy street, six cars and a bus

Pages crop these at render time. Nothing here was resized or re-encoded.

Source and licence
------------------
Drive.ai Sample Dataset, licensed Creative Commons Attribution 4.0
International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/

The files ship with the "Autonomous driving, car detection" programming
assignment of the DeepLearning.AI Convolutional Neural Networks course
(Course 4 of the Deep Learning Specialization), whose local copy is
Labs/DL/CNN/05 Car detection with YOLO/images/. The full sample is 120
frames. Only the four relevant to current or retained figures are hosted here.

Bounding boxes drawn on these photographs
-----------------------------------------
The boxes in the figures are not hand-drawn. They were produced once, offline,
by running the YOLO model that ships with the same assignment
(model_data/, a SavedModel with a 608 x 608 input and a 19 x 19 x 425 output)
over each photograph, decoding it with the standard YOLOv2 rules, and keeping
detections above a 0.6 score after non-max suppression at 0.5 IoU. The
resulting centres and sizes, in fractions of the image, are recorded in the
figure code of the pages that use them.

0060.jpg was checked the same way with the threshold dropped to 0.15. The
cropped region used on the page holds no car, no person and no motorcycle at
that threshold; the only thing the model reports at all is a 15 percent guess
at a potted plant. That is why the crop can honestly be labelled background
for the three classes these notes use.

The 0055.jpg crop was checked too. It holds the one car the figures box, at
74 percent, plus a 39 percent traffic light near its upper edge. A traffic
light is not one of the three classes, so it is correctly left unboxed.

0020.jpg carries no boxes on any page. Its per-pixel labels remain in
../semantic-segmentation/ so that the earlier figure can still be reproduced.

car-building-pexels-10465615.jpg
--------------------------------
A separate 1280 x 853 photograph used by semantic-segmentation-with-u-net.qmd.
It shows one sedan in profile, a building behind it, and road beneath it. The
page uses a 960 x 720 crop that removes the person at the far-left edge.

The photograph is by Sami Aksu and was downloaded from Pexels at 1280 pixels
wide.

  https://www.pexels.com/photo/car-in-front-of-building-on-city-street-10465615/

It carries the Pexels license, https://www.pexels.com/license/. The license
allows free use and modification without asking permission or giving
attribution, and forbids selling unaltered copies or implying endorsement. The
page credits the photographer even though the license does not require it.

The downloaded JPEG has this SHA-256 digest.

  ce02be1198dd8eaed601a2fb8e0927760d06d176d8c423e62c45492a5ed54976

motorcycle-pexels-995487.jpg
----------------------------
A separate photograph, not from Drive.ai, used by a review question on
object-localization-and-landmark-detection.qmd. A classic scooter parked at the
side of a road, 1280 x 815, downloaded from Pexels at that width:

  https://www.pexels.com/es-es/foto/fotografia-de-motocicleta-clasica-en-carretera-995487/

It carries the Pexels licence, which allows free use and modification without
asking permission or giving attribution, and forbids selling unaltered copies
and implying that the photographer endorses anything.

The bounding box quoted in that review question was not eyeballed. It is the
tight box around the motorbike mask predicted by DeepLabV3 with a ResNet-101
backbone on the Pascal VOC classes, run once offline over this exact file,
which gives x from 163 to 487 and y from 281 to 552. As fractions of the image
that is a centre at (0.25, 0.51) with height 0.33 and width 0.25. Re-crop or
resize the file and those four numbers stop being correct.
