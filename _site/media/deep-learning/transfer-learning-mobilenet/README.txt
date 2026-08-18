Alpaca / Not Alpaca image dataset for transfer learning
======================================================

327 RGB JPEG photographs in two class folders, at their original resolution
(1024 pixels on the longest side, 117 MB in total):

  dataset/alpaca/       142 images
  dataset/not alpaca/   185 images

Hosting
-------
The images are too large to ship with the site, so this folder is kept
locally for rendering only and its copy under _site/ is excluded from the
repository. Readers download the two folders from Google Drive instead, and
the lab page links them:

  alpaca      https://drive.google.com/drive/folders/1v8-NpADjcu43Ct383nFfDb5H_33ft6y0?usp=sharing
  not alpaca  https://drive.google.com/drive/folders/1jkKkf_aEzBdPTDdPr0OynjfslKhVo_bO?usp=sharing

Nothing was resized, re-encoded, or renamed. The lab feeds the images to
image_dataset_from_directory with image_size=(160, 160), which does the
resizing at load time.

Two .DS_Store files that macOS left in the original folders were dropped
here. One of them is still present in the Drive copy of alpaca/, which is
why Drive shows 143 items in a folder of 142 photographs.

Source
------
The dataset ships with the "Transfer Learning with MobileNetV2" programming
assignment of the DeepLearning.AI Convolutional Neural Networks course
(Course 4 of the Deep Learning Specialization). Every filename is a
16-character hexadecimal ID and every image is 1024 pixels on its longest
side, which are the conventions of Google's Open Images Dataset.

The course notes that the original dataset contains a few mislabelled
images. They were left in place.
