<?php
use Drupal\block_content\Entity\BlockContent;

$blocks = [
  [
    'info' => 'Newsletter signup',
    'body' => '<p class="text-align-center">Stay connected with our latest news, articles, webinars, and more.</p>
<form action="https://sendfox.com/form/3znjz3/3e4kk1" class="sendfox-form pf-newsletter" data-async="true" id="3e4kk1" method="post">
<p><input name="first_name" placeholder="First Name" required="" type="text" /></p>
<p><input name="last_name" placeholder="Last Name" required="" type="text" /></p>
<p><input name="email" placeholder="Email" required="" type="email" /></p>
<!-- no botz please -->
<div aria-hidden="true" style="position: absolute; left: -5000px;"><input autocomplete="off" name="a_password" tabindex="-1" type="text" value="" /></div>
<p><button type="submit">Submit</button></p>
</form>
<script src="https://sendfox.com/js/form.js"></script>',
  ],
  [
    'info' => 'Campaign Kit Logo',
    // Strip data-entity-uuid (not portable); use plain src path
    'body' => '<p><img alt="Campaign Kit" src="/sites/default/files/inline-images/ck-logo-official.png" /></p>',
  ],
  [
    'info' => 'Layout Builder Kit Logo',
    'body' => '<p><img alt="Layout Builder Kit" height="167" src="/sites/default/files/inline-files/lbk-logo.png" width="859" /></p>',
  ],
  [
    'info' => 'Copyright',
    'body' => '<p>Copyright 2025 Performant Labs | All rights reserved.</p>',
  ],
  [
    'info' => 'Performant Labs',
    'body' => '<p>We build and test world-class websites.</p>',
  ],
];

foreach ($blocks as $data) {
  // Skip if already exists by label
  $existing = \Drupal::entityTypeManager()->getStorage('block_content')
    ->loadByProperties(['info' => $data['info']]);
  if (!empty($existing)) {
    $b = reset($existing);
    echo "EXISTS [{$b->id()}] {$data['info']}\n";
    continue;
  }

  $block = BlockContent::create([
    'type'   => 'basic',
    'info'   => $data['info'],
    'body'   => ['value' => $data['body'], 'format' => 'content_format'],
    'status' => 1,
  ]);
  $block->save();
  echo "CREATED [{$block->id()}] {$data['info']}\n";
}

echo "\nDone.\n";
