Road scenes for the object detection notes
==========================================

Three photographs, 1280 x 720, unmodified originals:

  0019.jpg   one car close to the camera, plus a truck on the right
  0061.jpg   a stretch of road with no vehicle, pedestrian or motorcycle
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
frames; only the three used by a figure are hosted here.

Bounding boxes drawn on these photographs
-----------------------------------------
The boxes in the figures are not hand-drawn. They were produced once, offline,
by running the YOLO model that ships with the same assignment
(model_data/, a SavedModel with a 608 x 608 input and a 19 x 19 x 425 output)
over each photograph, decoding it with the standard YOLOv2 rules, and keeping
detections above a 0.6 score after non-max suppression at 0.5 IoU. The
resulting centres and sizes, in fractions of the image, are recorded in the
figure code of the pages that use them.

0061.jpg was checked the same way with the threshold dropped to 0.15. The
cropped region used on the page holds no car, no person and no motorcycle at
that threshold; the only thing the model reports at all is a 15 percent guess
at a potted plant. That is why the crop can honestly be labelled background
for the three classes these notes use.

The 0019.jpg crop was checked too. It holds the one car the figures box, at
74 percent, plus a 39 percent traffic light near its upper edge. A traffic
light is not one of the three classes, so it is correctly left unboxed.
